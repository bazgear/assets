/* ============================================================
   Funnel Engine – Standalone
   No dependencies, CMS-safe, JSON-driven
   ============================================================ */

(async function () {
  const app = document.getElementById("app");
  if (!app) {
    console.error("Funnel engine: #app element not found");
    return;
  }

  /* ------------------ Load Funnel ------------------ */
  const funnel = window.FUNNEL
    ? window.FUNNEL
    : await fetch(window.FUNNEL_URL).then(r => r.json());

  /* ------------------ State ------------------ */
  const state = {
    stepId: funnel.start,
    flowStack: [], // { flowId, returnTo }
    context: {
      lead: {},
      answers: {},
      api: {},
      system: { variant: {} }
    }
  };

  /* ------------------ Utils ------------------ */
  const $ = s => document.querySelector(s);

  function deepGet(obj, path) {
    if (!path) return;
    return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  }

  function deepSet(obj, path, val) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c =>
      ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c])
    );
  }

  function isSet(v) {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim() !== "";
    return true;
  }

  /* ------------------ Routing ------------------ */
  function resolveStep(id) {
    if (state.flowStack.length) {
      const top = state.flowStack[state.flowStack.length - 1];
      const flow = funnel.flows[top.flowId];
      if (flow?.steps?.[id]) return flow.steps[id];
    }
    return funnel.steps[id];
  }

  function goTo(id) {
    state.stepId = id;
    render();
  }

  function enterFlow(flowId, returnTo) {
    const flow = funnel.flows[flowId];
    if (!flow) throw `Unknown flow ${flowId}`;
    state.flowStack.push({ flowId, returnTo });
    goTo(flow.start);
  }

  function exitFlow() {
    const popped = state.flowStack.pop();
    goTo(popped ? popped.returnTo : "done");
  }

  /* ------------------ Rules ------------------ */
  function evalCond(cond) {
    if (cond.eq) {
      const [p, v] = cond.eq;
      return deepGet(state, p) === v;
    }
    if (cond.contains) {
      const [p, v] = cond.contains;
      const arr = deepGet(state, p);
      return Array.isArray(arr) && arr.includes(v);
    }
    if (cond.notSet) {
      return !isSet(deepGet(state, cond.notSet[0]));
    }
    if (cond.and) return cond.and.every(evalCond);
    if (cond.or) return cond.or.some(evalCond);
    return false;
  }

  /* ------------------ Renderers ------------------ */
  function render() {
    const step = resolveStep(state.stepId);
    if (!step) {
      app.innerHTML = `<pre>Unknown step: ${state.stepId}</pre>`;
      return;
    }

    switch (step.type) {
      case "landing": return renderLanding(step);
      case "question_single": return renderSingle(step);
      case "question_multi": return renderMulti(step);
      case "form": return renderForm(step);
      case "router": return runRouter(step);
      case "flow_ref": return enterFlow(step.flowId, step.next);
      case "results": return renderResults(step);
      case "end": return renderEnd(step);
      default:
        app.innerHTML = `<pre>Unsupported step type: ${step.type}</pre>`;
    }
  }

  function renderLanding(step) {
    const key = state.stepId;
    const variant =
      state.context.system.variant[key] ||
      (state.context.system.variant[key] =
        step.variantStrategy === "random"
          ? step.variants[Math.floor(Math.random() * step.variants.length)]
          : step.variants[0]);

    app.innerHTML = `
      <h1>${escapeHtml(variant.headline)}</h1>
      <p>${escapeHtml(variant.description || "")}</p>
      ${variant.lowerTip ? `<small>${escapeHtml(variant.lowerTip)}</small>` : ""}
      <br><br>
      <button id="cta">${escapeHtml(variant.cta?.label || "Start")}</button>
    `;

    $("#cta").onclick = () => goTo(step.next);
  }

  function renderSingle(step) {
    app.innerHTML = `
      <h1>${escapeHtml(step.question)}</h1>
      ${step.tip ? `<p>${escapeHtml(step.tip)}</p>` : ""}
      <div id="opts"></div>
    `;

    const opts = $("#opts");

    step.options.forEach(opt => {
      const b = document.createElement("button");
      b.textContent = opt.label;
      b.onclick = () => {
        if (step.bind) {
          deepSet(state, step.bind, opt.value ?? opt.id);
        }
        goTo(opt.next || step.next);
      };
      opts.appendChild(b);
    });
  }

  function renderMulti(step) {
    const selected = new Set(step.preselect || []);
    app.innerHTML = `
      <h1>${escapeHtml(step.question)}</h1>
      <div id="opts"></div>
      <br><button id="next">Next</button>
    `;

    const opts = $("#opts");

    step.options.forEach(opt => {
      const b = document.createElement("button");
      b.textContent = opt.label;
      if (selected.has(opt.id)) b.style.fontWeight = "bold";
      b.onclick = () => {
        selected.has(opt.id) ? selected.delete(opt.id) : selected.add(opt.id);
        b.style.fontWeight = selected.has(opt.id) ? "bold" : "normal";
      };
      opts.appendChild(b);
    });

    $("#next").onclick = () => {
      if (step.bind) deepSet(state, step.bind, [...selected]);
      goTo(step.next);
    };
  }

  function renderForm(step) {
    app.innerHTML = `
      <h1>${escapeHtml(step.question)}</h1>
      <div id="fields"></div>
      <br><button id="submit">${escapeHtml(step.cta || "Next")}</button>
    `;

    const fields = $("#fields");

    step.fields.forEach(f => {
      fields.insertAdjacentHTML(
        "beforeend",
        `<label>${escapeHtml(f.label)}<br>
         <input id="${f.id}" placeholder="${escapeHtml(f.placeholder || "")}">
         </label><br>`
      );
    });

    $("#submit").onclick = () => {
      for (const f of step.fields) {
        const v = document.getElementById(f.id).value;
        if (f.required && !v) return alert(`Required: ${f.label}`);
        if (f.bind) deepSet(state, f.bind, v);
      }
      const next = step.onSubmit?.next || step.next;
      next === "__end__" ? exitFlow() : goTo(next);
    };
  }

  function runRouter(step) {
    for (const r of step.routes) {
      if (evalCond(r.when)) return goTo(r.to);
    }
    step.defaultNext === "__end__" ? exitFlow() : goTo(step.defaultNext);
  }

  function renderResults(step) {
    app.innerHTML = `<h1>${escapeHtml(step.loading?.headline || "Loading…")}</h1>`;
    setTimeout(() => {
      // black box API mocked here
      app.innerHTML = `
        <h1>Your best matches</h1>
        <p>(API integration goes here)</p>
        <button onclick="location.reload()">Restart</button>
      `;
    }, 800);
  }

  function renderEnd(step) {
    app.innerHTML = `
      <h1>${escapeHtml(step.title || "Done")}</h1>
      <p>${escapeHtml(step.body || "")}</p>
      <button onclick="location.reload()">Restart</button>
    `;
  }

  /* ------------------ Start ------------------ */
  render();
})();
