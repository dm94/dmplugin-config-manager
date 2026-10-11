const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
let state = { bots: [], interval_hours: 8, ai_url: "", ai_model: "", ai_api_key_configured: false, running_reviews: [] };
let settingsDirty = false;
let toastTimer;

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store", ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
  return result;
}

function number(value) {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(parsed) : "—";
}

function waitLabel(timestamp) {
  if (!timestamp) return "Pendiente de primera revisión";
  const delta = Number(timestamp) * 1000 - Date.now();
  if (delta <= 0) return "Revisión pendiente";
  const hours = Math.floor(delta / 3600000);
  const minutes = Math.floor((delta % 3600000) / 60000);
  return `Próxima revisión en ${hours ? `${hours} h ` : ""}${minutes} min`;
}

function profileName(bot) {
  return bot.current_profile || "Perfil actual sin indicar";
}

function renderBot(bot) {
  const result = bot.last_result || {};
  const status = result.status || {};
  const stats = result.stats?.general || {};
  const recommendation = result.recommendation || {};
  const busy = state.running_reviews.includes(bot.id);
  const online = result.source === "connection" ? true : result.ok === true;
  const message = result.ok === false ? result.error : (result.outcome || recommendation.summary || "Conectado. Ejecuta una revisión para obtener una recomendación.");
  const event = result.events?.generic?.status;
  const eventActive = event && !["INACTIVE", "NONE", "UNAVAILABLE"].includes(String(event).toUpperCase());
  return `<article class="panel bot-card" data-bot-id="${escapeHtml(bot.id)}">
    <div class="bot-top"><div class="bot-title"><span class="bot-icon" aria-hidden="true">${escapeHtml(bot.name.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHtml(bot.name)}</h3><span class="bot-subtitle">${escapeHtml(profileName(bot))} · ${escapeHtml(waitLabel(bot.next_review_at))}</span></div></div><span class="bot-state ${online ? "" : "offline"}">${busy ? "REVISANDO" : online ? (bot.enabled ? "CONECTADO" : "PAUSADO") : "REVISIÓN FALLIDA"}</span></div>
    <div class="bot-metrics"><div class="metric"><small>Créditos</small><b>${number(stats.credits)}</b></div><div class="metric"><small>Uridium · reservado para puertas</small><b>${number(stats.uridium)}</b></div><div class="metric"><small>Estado / mapa</small><b>${escapeHtml(status.map_name || "Sin datos")}</b></div><div class="metric"><small>Evento NPC</small><b>${escapeHtml(eventActive ? event : "Sin evento activo")}</b></div></div>
    <div class="bot-bottom"><div class="review-note">${escapeHtml(message)}${recommendation.confidence ? ` · Confianza ${Math.round(recommendation.confidence * 100)}%` : ""}${result.reviewed_at ? ` · ${escapeHtml(new Date(result.reviewed_at).toLocaleString("es-ES"))}` : ""}</div><div class="bot-actions"><label class="autotoggle"><input class="auto-apply" type="checkbox" ${bot.auto_apply ? "checked" : ""} aria-label="Aplicar automáticamente perfiles guardados para ${escapeHtml(bot.name)}"> Aplicar perfil guardado</label><button class="button button-quiet review-button" type="button" ${busy ? "disabled" : ""}>${busy ? "Analizando…" : "Revisar ahora"}</button><button class="text-button remove-button" type="button" aria-label="Eliminar ${escapeHtml(bot.name)}">Eliminar</button></div></div>
  </article>`;
}

function render() {
  $("#bot-count").textContent = state.bots.length;
  if (!settingsDirty) {
    $("#interval-hours").value = state.interval_hours;
    $("#ai-url").value = state.ai_url;
    $("#ai-model").value = state.ai_model;
  }
  $("#ai-api-key").placeholder = state.ai_api_key_configured ? "Guardada (vacío conserva la actual)" : "No configurada";
  $("#clear-ai-api-key").disabled = !state.ai_api_key_configured;
  $("#ai-status").textContent = state.ai_url && state.ai_model ? `API compatible configurada${state.ai_api_key_configured ? " · key guardada" : " · sin key"}` : "Configura URL y modelo";
  $("#ai-status").style.color = state.ai_url && state.ai_model ? "#1c7952" : "#a45b49";
  $("#bot-list").innerHTML = state.bots.map(renderBot).join("");
  $("#empty-state").hidden = state.bots.length > 0;
  document.querySelectorAll("#bot-list .review-button").forEach((button) => {
    if (button.closest("[data-bot-id]") && state.running_reviews.includes(button.closest("[data-bot-id]").dataset.botId)) {
      button.disabled = true;
      button.textContent = "Analizando…";
    }
  });
  $("#clock").textContent = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
}

async function refresh() {
  try {
    state = await api("/api/state");
    render();
  } catch (error) {
    $("#ai-status").textContent = "Gestor desconectado";
    toast(error.message);
  }
}

function setAddForm(open) {
  $("#add-bot-panel").hidden = !open;
  $("#add-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("#add-bot-panel").querySelector("input[name=name]").focus();
}

$("#add-toggle").addEventListener("click", () => setAddForm($("#add-bot-panel").hidden));
$("#empty-add").addEventListener("click", () => setAddForm(true));
$("#cancel-add").addEventListener("click", () => setAddForm(false));

$("#add-bot-panel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Conectando…";
  try {
    const result = await api("/api/bots", { method: "POST", body: JSON.stringify({
      name: form.get("name"), port: form.get("port"),
      current_profile: form.get("current_profile"), profile_notes: form.get("profile_notes"),
      url: `http://127.0.0.1:${form.get("port")}/mcp`
    }) });
    state.bots.push(result.bot);
    render();
    formElement.reset();
    formElement.elements.port.value = "9876";
    setAddForm(false);
    toast("Bot conectado. Solicita una revisión para recibir la recomendación de IA.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Conectar y leer estado";
  }
});

$("#settings-form").addEventListener("input", () => { settingsDirty = true; });

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/settings", { method: "POST", body: JSON.stringify({
      interval_hours: Number($("#interval-hours").value),
      ai_url: $("#ai-url").value, ai_model: $("#ai-model").value,
      ai_api_key: $("#ai-api-key").value,
      clear_ai_api_key: $("#clear-ai-api-key").checked
    }) });
    $("#clear-ai-api-key").checked = false;
    settingsDirty = false;
    await refresh();
    $("#ai-api-key").value = "";
    toast("Preferencias guardadas.");
  } catch (error) { toast(error.message); }
});

$("#bot-list").addEventListener("click", async (event) => {
  const card = event.target.closest("[data-bot-id]");
  if (!card) return;
  const endpoint = `/api/bots/${encodeURIComponent(card.dataset.botId)}`;
  try {
    if (event.target.closest(".review-button")) {
      await api(`${endpoint}/review`, { method: "POST", body: "{}" });
      toast("Análisis iniciado con la API configurada.");
      await refresh();
    } else if (event.target.closest(".remove-button")) {
      if (!window.confirm("¿Desconectar este bot de la aplicación local?")) return;
      state = await api(endpoint, { method: "DELETE" });
      render();
      toast("Bot desconectado.");
    }
  } catch (error) { toast(error.message); }
});

$("#bot-list").addEventListener("change", async (event) => {
  const card = event.target.closest("[data-bot-id]");
  if (!card || !event.target.matches(".auto-apply")) return;
  try {
    await api(`/api/bots/${encodeURIComponent(card.dataset.botId)}/auto`, {
      method: "POST", body: JSON.stringify({ auto_apply: event.target.checked })
    });
    const bot = state.bots.find((item) => item.id === card.dataset.botId);
    if (bot) bot.auto_apply = event.target.checked;
    toast(event.target.checked ? "Se aplicarán automáticamente solo perfiles MCP existentes." : "Aplicación automática desactivada.");
  } catch (error) {
    event.target.checked = !event.target.checked;
    toast(error.message);
  }
});

refresh();
setInterval(refresh, 12000);
setInterval(() => { $("#clock").textContent = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date()); }, 30000);
