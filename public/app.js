(() => {
  "use strict";

  const POLL_MS = 2000;

  async function api(method, url, opts = {}) {
    const headers = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.ownerToken) headers["x-owner-token"] = opts.ownerToken;
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  const $ = (sel) => document.querySelector(sel);
  const sessionFromUrl = () => new URLSearchParams(location.search).get("s");
  const ownerFromHash = () => new URLSearchParams(location.hash.slice(1)).get("owner");

  function participantId(sessionId) {
    const key = `icebreaker:pid:${sessionId}`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
      localStorage.setItem(key, id);
    }
    return id;
  }

  function setStatus(el, message, kind) {
    el.textContent = message || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  // ---------- Landing page ----------
  function initIndex() {
    const titleInput = $("#title");
    const createBtn = $("#create");
    const setup = $("#setup");
    const result = $("#result");
    const status = $("#status");

    createBtn.addEventListener("click", async () => {
      createBtn.disabled = true;
      setStatus(status, "Creating session…");
      try {
        const data = await api("POST", "/api/sessions", { body: { title: titleInput.value } });
        $("#join-link").textContent = data.joinUrl;
        $("#master-link").textContent = data.masterUrl;
        $("#open-master").href = data.masterUrl;
        setup.classList.add("hidden");
        result.classList.remove("hidden");
        setStatus(status, "");
      } catch (err) {
        setStatus(status, err.message, "error");
        createBtn.disabled = false;
      }
    });

    document.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const text = $(btn.getAttribute("data-copy")).textContent;
        try {
          await navigator.clipboard.writeText(text);
          const old = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = old), 1200);
        } catch {
          /* clipboard not available */
        }
      });
    });
  }

  // ---------- Participant page ----------
  function initJoin() {
    const sessionId = sessionFromUrl();
    const form = $("#form");
    const closed = $("#closed");
    const nameInput = $("#name");
    const statementInput = $("#statement");
    const saveBtn = $("#save");
    const status = $("#status");

    if (!sessionId) {
      setStatus(status, "This link is missing a session id.", "error");
      form.classList.add("hidden");
      return;
    }
    const pid = participantId(sessionId);
    let loadedOnce = false;

    async function refresh() {
      try {
        const state = await api("GET", `/api/sessions/${sessionId}/participant?pid=${pid}`);
        if (state.title) $("#prompt").textContent = state.title;
        if (!loadedOnce && state.card) {
          nameInput.value = state.card.name;
          statementInput.value = state.card.statement;
        }
        loadedOnce = true;
        if (state.submissionsOpen) {
          form.classList.remove("hidden");
          closed.classList.add("hidden");
        } else {
          form.classList.add("hidden");
          closed.classList.remove("hidden");
        }
      } catch (err) {
        setStatus(status, err.message, "error");
      }
    }

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      setStatus(status, "Saving…");
      try {
        await api("POST", `/api/sessions/${sessionId}/cards`, {
          body: { participantId: pid, name: nameInput.value, statement: statementInput.value },
        });
        setStatus(status, "Saved! You can edit until the reveal starts.", "good");
      } catch (err) {
        setStatus(status, err.message, "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    refresh();
    setInterval(refresh, POLL_MS);
  }

  // ---------- Master page ----------
  function initMaster() {
    const sessionId = sessionFromUrl();
    const ownerToken = ownerFromHash();
    const collectView = $("#collect");
    const revealView = $("#reveal");
    const status = $("#status");

    if (!sessionId || !ownerToken) {
      setStatus(status, "This master link is incomplete.", "error");
      return;
    }

    const opts = { ownerToken };

    async function refresh() {
      try {
        const state = await api("GET", `/api/sessions/${sessionId}/master`, opts);
        if (state.title) $("#prompt").textContent = state.title;
        if (state.phase === "collect") renderCollect(state);
        else renderReveal(state);
        setStatus(status, "");
      } catch (err) {
        setStatus(status, err.message, "error");
      }
    }

    function renderCollect(state) {
      revealView.classList.add("hidden");
      collectView.classList.remove("hidden");
      $("#count").textContent = state.submittedCount;
      $("#start").disabled = state.submittedCount < 1;
    }

    function renderReveal(state) {
      collectView.classList.add("hidden");
      revealView.classList.remove("hidden");

      const guide = $("#guide");
      const statementEl = $("#statement");
      const nameEl = $("#reveal-name");
      const progress = $("#progress");
      const doneBadge = $("#done-badge");

      if (state.index < 0) {
        statementEl.textContent = "";
        guide.textContent = "Click “Next” to reveal the first statement.";
        guide.classList.remove("hidden");
      } else {
        guide.classList.add("hidden");
        statementEl.textContent = state.statement || "";
      }

      if (state.name) {
        nameEl.classList.remove("hidden");
        nameEl.innerHTML = `<span class="who">written by</span>${escapeHtml(state.name)}`;
      } else {
        nameEl.classList.add("hidden");
      }

      progress.textContent =
        state.index >= 0 ? `Card ${state.index + 1} of ${state.totalCards}` : `${state.totalCards} cards`;
      doneBadge.classList.toggle("hidden", !state.done);
      $("#back").disabled = state.step <= 0;
      $("#next").disabled = state.done;
    }

    $("#start").addEventListener("click", () =>
      guard(() => api("POST", `/api/sessions/${sessionId}/reveal/start`, opts)),
    );
    $("#next").addEventListener("click", () =>
      guard(() => api("POST", `/api/sessions/${sessionId}/reveal/step`, { ...opts, body: { direction: "next" } })),
    );
    $("#back").addEventListener("click", () =>
      guard(() => api("POST", `/api/sessions/${sessionId}/reveal/step`, { ...opts, body: { direction: "back" } })),
    );
    $("#reset").addEventListener("click", () => {
      if (confirm("Reopen submissions and clear the reveal order?")) {
        guard(() => api("POST", `/api/sessions/${sessionId}/reveal/reset`, opts));
      }
    });

    async function guard(action) {
      try {
        await action();
        await refresh();
      } catch (err) {
        setStatus(status, err.message, "error");
      }
    }

    refresh();
    setInterval(refresh, POLL_MS);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  const page = document.body.dataset.page;
  if (page === "index") initIndex();
  else if (page === "join") initJoin();
  else if (page === "master") initMaster();
})();
