/* EDU APP TRACKER — Google sign-in and calls to the Apps Script backend */
const Api = (function () {
  const TOKEN_KEY = "edu_id_token";
  let token = "";
  let gisPromise = null;

  function cfg() {
    return globalThis.EDU_CONFIG || {};
  }

  function configured() {
    return !!(cfg().API_URL && cfg().GOOGLE_CLIENT_ID);
  }

  function claims(value) {
    try {
      let part = String(value || "").split(".")[1] || "";
      part = part.replace(/-/g, "+").replace(/_/g, "/");
      while (part.length % 4) part += "=";
      const bin = atob(part);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
      return {};
    }
  }

  function fresh(value) {
    const exp = Number(claims(value).exp || 0) * 1000;
    return exp - Date.now() > 60 * 1000;
  }

  function restore() {
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY) || "";
      if (saved && fresh(saved)) token = saved;
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      token = "";
    }
    return hasToken();
  }

  function hasToken() {
    return !!token && fresh(token);
  }

  function setToken(value) {
    token = value;
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch (err) {
      /* private mode: keep the token in memory only */
    }
  }

  function signOut() {
    token = "";
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* ignore */
    }
    try {
      if (globalThis.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    } catch (err) {
      /* ignore */
    }
  }

  function loadGis() {
    if (globalThis.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisPromise = null;
        reject(new Error("โหลดปุ่มเข้าสู่ระบบ Google ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"));
      };
      document.head.appendChild(script);
    });
    return gisPromise;
  }

  async function mountButton(el, onSignedIn) {
    await loadGis();
    google.accounts.id.initialize({
      client_id: cfg().GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response && response.credential) {
          setToken(response.credential);
          onSignedIn();
        }
      },
      auto_select: true,
      cancel_on_tap_outside: true,
    });
    el.innerHTML = "";
    google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with", locale: "th" });
  }

  function profile() {
    const c = hasToken() ? claims(token) : {};
    return { email: String(c.email || ""), name: String(c.name || "") };
  }

  function apiError(message, status, code) {
    const err = new Error(message);
    err.status = status;
    err.code = code || "";
    return err;
  }

  async function call(action, data) {
    if (!hasToken()) {
      signOut();
      throw apiError("หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
    }
    let res;
    try {
      res = await fetch(cfg().API_URL, {
        method: "POST",
        // text/plain keeps this a "simple" request, which Apps Script accepts without a CORS preflight
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken: token, action, data: data || {} }),
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
      });
    } catch (err) {
      throw apiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", 0);
    }
    let out = null;
    try {
      out = await res.json();
    } catch (err) {
      throw apiError("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง", res.status || 500);
    }
    if (!out || !out.ok) {
      const status = (out && out.status) || 500;
      if (status === 401) signOut();
      throw apiError((out && out.error) || "ทำรายการไม่สำเร็จ", status, out && out.code);
    }
    return out.result;
  }

  return { configured, restore, hasToken, profile, mountButton, call, signOut };
})();

globalThis.Api = Api;
