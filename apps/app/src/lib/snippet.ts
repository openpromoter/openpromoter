/**
 * op.js: the tracking snippet served to founders' sites. Plain ES2017, no dependencies, ~2 KB.
 * Kept as a string so it can be served with the right base URL and tested in isolation.
 * The served script is MIT licensed (see its banner) so it can run on any site; this file is AGPL.
 */
export function snippet(base: string): string {
  return `/*! OpenPromoter op.js | MIT | https://openpromoter.com */
(function () {
  var s = document.currentScript || document.querySelector('script[data-program]');
  if (!s) return;
  var BASE = ${JSON.stringify(base)};
  var program = s.getAttribute("data-program");
  var param = s.getAttribute("data-param") || "via";
  var domain = s.getAttribute("data-domain");
  var needConsent = s.getAttribute("data-consent") === "required";
  // data-storage="none": never write a cookie; attribution rides on the click id passed to checkout
  var noStorage = s.getAttribute("data-storage") === "none";
  // data-api: first-party proxy path on your own domain (e.g. "/op") so ad blockers don't drop clicks
  var api = s.getAttribute("data-api");
  if (api) BASE = api.replace(/\\/$/, "");
  var consented = !needConsent;
  var KEY = "op_ref";
  var state = { clickId: null, visitorId: null, code: null };
  var q = (window.openpromoter && window.openpromoter.q) || [];

  function readCookie() {
    var m = document.cookie.match(/(?:^|; )op_ref=([^;]*)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }
  function writeCookie(v, days) {
    if (!consented || noStorage) return;
    var c = KEY + "=" + encodeURIComponent(JSON.stringify(v)) + "; path=/; max-age=" + Math.round(days * 86400) + "; SameSite=Lax";
    if (domain) c += "; domain=" + domain;
    if (location.protocol === "https:") c += "; Secure";
    document.cookie = c;
  }
  function post(path, body) {
    return fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, credentials: "omit" })
      .then(function (r) { return r.status === 204 ? {} : r.json(); })
      .catch(function () { return {}; });
  }
  function apply(v) {
    state.clickId = v.c || null; state.visitorId = v.v || null; state.code = v.p || null;
    api.clickId = state.clickId; api.visitorId = state.visitorId; api.code = state.code;
    decorate();
  }
  function decorate() {
    var ref = state.clickId || state.visitorId;
    if (!ref) return;
    var links = document.querySelectorAll('a[href^="https://buy.stripe.com/"], a[href^="https://checkout.stripe.com/"]');
    for (var i = 0; i < links.length; i++) {
      try {
        var u = new URL(links[i].href);
        if (!u.searchParams.get("client_reference_id")) { u.searchParams.set("client_reference_id", ref); links[i].href = u.toString(); }
      } catch (e) {}
    }
    var els = document.querySelectorAll("stripe-pricing-table, stripe-buy-button");
    for (var j = 0; j < els.length; j++) if (!els[j].getAttribute("client-reference-id")) els[j].setAttribute("client-reference-id", ref);
  }

  var api = function (cmd, arg) {
    if (cmd === "consent") { consented = arg !== false; if (consented && state.clickId) writeCookie({ c: state.clickId, v: state.visitorId, p: state.code }, state.days || 60); }
    else if (cmd === "signup") return api.signup(arg);
  };
  api.signup = function (o) {
    if (!o || !o.email) return Promise.resolve({ ok: false });
    return post("/api/track/lead", { program: program, email: o.email, name: o.name || null, clickId: state.clickId, visitorId: state.visitorId, code: state.code });
  };
  api.consent = function (v) { api("consent", v); };
  window.openpromoter = api;

  var existing = readCookie();
  if (existing) apply(existing);
  var params = new URLSearchParams(location.search);
  var direct = params.get("op_click");
  // also honours the link parameters of Rewardful (via), FirstPromoter (fpr), Tolt (ref) and PartnerStack (gspk) so migrated links keep working
  var code = params.get(param) || params.get("via") || params.get("ref") || params.get("fpr") || params.get("gspk");
  if (direct && /^clk_/.test(direct)) {
    var v = { c: direct, v: params.get("op_visitor") || (existing && existing.v), p: code || (existing && existing.p) };
    var days = Number(params.get("op_days")) || 60;
    state.days = days;
    if (!(existing && existing.c && params.get("op_model") === "first_click")) { apply(v); writeCookie(v, days); }
  } else if (code) {
    post("/api/track/click", { program: program, code: code, visitorId: existing && existing.v, url: location.href, referrer: document.referrer || null, subId: params.get("sub") }).then(function (r) {
      if (!r || !r.ok) return;
      if (existing && existing.c && r.model === "first_click") return;
      var v2 = { c: r.clickId, v: r.visitorId, p: r.code };
      state.days = r.cookieDays || 60;
      apply(v2); writeCookie(v2, state.days);
    });
  }
  try {
    if (!sessionStorage.getItem("op_ping")) { sessionStorage.setItem("op_ping", "1"); post("/api/track/ping", { program: program }); }
  } catch (e) { post("/api/track/ping", { program: program }); }
  if (window.MutationObserver) new MutationObserver(decorate).observe(document.documentElement, { childList: true, subtree: true });
  for (var k = 0; k < q.length; k++) api.apply(null, q[k]);
})();
`;
}
