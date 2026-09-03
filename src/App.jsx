import { useState, useEffect, useRef, useCallback } from "react";
import { Folder, FolderPlus, FilePlus, ArrowLeft, Trash2, Pencil, Eraser, MousePointer2, MoveRight, X, Check, Palette, LogOut, Mail, Loader2, ChevronUp, ChevronDown, Triangle } from "lucide-react";

// ============================================================
// CONFIGURA AQUÍ TUS CLAVES DE SUPABASE
// ============================================================
const SUPABASE_URL = "https://skozlrpdjoxbvzgjumzz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8CrcBtHiApBXq22DeDru7g_UpTET0GM";
// ============================================================

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#111827"];
const uid = () => Math.random().toString(36).slice(2, 10);

// ---- Límites del plan gratuito (Paso 1 de la versión free/premium) ----
const FREE_MAX_FOLDERS = 2;
const FREE_MAX_PROJECTS_PER_FOLDER = 3;

// ---- Mini cliente REST para Supabase (sin librerías externas) ----
function makeSupabase(url, key) {
  let accessToken = null;
  let refreshToken = null;

  const authHeaders = () => ({
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${accessToken || key}`,
  });

  return {
    setSession(session) {
      accessToken = session?.access_token || null;
      refreshToken = session?.refresh_token || null;
    },
    getRefreshToken() { return refreshToken; },

    async signInWithOtp(email, redirectTo, fullName) {
      const res = await fetch(`${url}/auth/v1/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify({
          email,
          create_user: true,
          data: fullName ? { full_name: fullName } : undefined,
          options: { email_redirect_to: redirectTo },
        }),
      });
      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch (e) {}
        const msg = data.error_description || data.msg || data.message || data.error_code || `Error ${res.status}`;
        throw new Error(msg);
      }
      return true;
    },

    async verifyOtp(email, token) {
      const res = await fetch(`${url}/auth/v1/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify({ email, token, type: "email" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || "Código incorrecto");
      return data;
    },

    async refreshSession(rToken) {
      const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify({ refresh_token: rToken }),
      });
      if (!res.ok) return null;
      return res.json();
    },

    async getUser() {
      const res = await fetch(`${url}/auth/v1/user`, { headers: authHeaders() });
      if (!res.ok) return null;
      return res.json();
    },

    async signOut() {
      try { await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: authHeaders() }); } catch (e) {}
      accessToken = null; refreshToken = null;
    },

    async select(table, query = "") {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error leyendo ${table}`);
      return res.json();
    },
    async insert(table, payload) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...authHeaders(), Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error creando en ${table}`);
      return res.json();
    },
    async update(table, id, payload) {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error actualizando ${table}`);
      return res.json();
    },
    async remove(table, id) {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(`Error eliminando en ${table}`);
      return true;
    },
  };
}

const sb = makeSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Guardado del token de sesión en el navegador del usuario ----
const TOKEN_KEY = "padel-coach-refresh-token";
const sessionStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} },
};

export default function App() {
  const [authState, setAuthState] = useState("loading");
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState("");

  const [folders, setFolders] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataError, setDataError] = useState("");
  const [view, setView] = useState({ screen: "home" });
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState(COLORS[0]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [modal, setModal] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedArrowId, setSelectedArrowId] = useState(null);

  // "premium" solo si Supabase lo marca explícitamente en user_metadata; cualquier otro caso (incluido null) es "free".
  const plan = user?.user_metadata?.plan === "premium" ? "premium" : "free";

  useEffect(() => {
    (async () => {
      // 1. ¿Venimos de hacer clic en el enlace del email? Supabase pone el token en el fragmento de la URL.
      try {
        const hash = window.location.hash;
        if (hash && hash.includes("access_token")) {
          const params = new URLSearchParams(hash.replace("#", ""));
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          if (access_token && refresh_token) {
            sb.setSession({ access_token, refresh_token });
            sessionStore.set(refresh_token);
            const u = await sb.getUser();
            if (u && !u.error) {
              setUser(u);
              setAuthState("signedIn");
              // limpiar la URL para no dejar el token visible
              window.history.replaceState(null, "", window.location.pathname);
              return;
            }
          }
        }
      } catch (e) {}

      // 2. ¿Tenemos una sesión guardada de antes?
      try {
        const stored = sessionStore.get();
        if (stored) {
          const session = await sb.refreshSession(stored);
          if (session?.access_token) {
            sb.setSession(session);
            sessionStore.set(session.refresh_token);
            const u = await sb.getUser();
            if (u && !u.error) { setUser(u); setAuthState("signedIn"); return; }
          }
        }
      } catch (e) {}
      setAuthState("signedOut");
    })();
  }, []);

  useEffect(() => {
    if (authState !== "signedIn") return;
    (async () => {
      try {
        setDataError("");
        const [fRows, pRows] = await Promise.all([
          sb.select("folders", "select=id,name,created_at&order=created_at.asc"),
          sb.select("projects", "select=id,folder_id,name,sport,notes,arrows,strokes,cones,created_at&order=created_at.asc"),
        ]);
        const merged = fRows.map(f => ({
          id: f.id,
          name: f.name,
          createdAt: f.created_at,
          projects: pRows.filter(p => p.folder_id === f.id).map(p => ({
            id: p.id, name: p.name, sport: p.sport || "padel", notes: p.notes || "",
            arrows: p.arrows || [], strokes: p.strokes || [], cones: p.cones || [], createdAt: p.created_at,
          })),
        }));
        setFolders(merged);
        setDataLoaded(true);
      } catch (e) {
        setDataError("No se pudieron cargar tus datos. Comprueba tu conexión e inténtalo de nuevo.");
        setDataLoaded(true);
      }
    })();
  }, [authState]);

  const sendLink = async () => {
    setAuthError("");
    if (!name.trim()) { setAuthError("Introduce tu nombre."); return; }
    if (!email.trim() || !email.includes("@")) { setAuthError("Introduce un email válido."); return; }
    setAuthBusy(true);
    try {
      await sb.signInWithOtp(email.trim(), window.location.origin + window.location.pathname, name.trim());
      setLinkSentTo(email.trim());
      setAuthState("linkSent");
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const doSignOut = async () => {
    await sb.signOut();
    sessionStore.clear();
    setUser(null); setFolders([]); setDataLoaded(false);
    setView({ screen: "home" }); setEmail(""); setName(""); setAuthError(""); setLinkSentTo("");
    setAuthState("signedOut");
  };

  const addFolder = async (name) => {
    const tempId = uid();
    setFolders(fs => [...fs, { id: tempId, name, projects: [], createdAt: Date.now() }]);
    try {
      const [row] = await sb.insert("folders", { name, user_id: user.id });
      setFolders(fs => fs.map(f => f.id === tempId ? { ...f, id: row.id } : f));
    } catch (e) { setDataError("No se pudo guardar la carpeta en el servidor."); }
  };

  const addProject = async (folderId, name, sport) => {
    const tempId = uid();
    const blank = { id: tempId, name, sport, notes: "", arrows: [], strokes: [], cones: [], createdAt: Date.now() };
    setFolders(fs => fs.map(f => f.id === folderId ? { ...f, projects: [...f.projects, blank] } : f));
    try {
      const [row] = await sb.insert("projects", { folder_id: folderId, user_id: user.id, name, sport, notes: "", arrows: [], strokes: [], cones: [] });
      setFolders(fs => fs.map(f => f.id === folderId ? { ...f, projects: f.projects.map(p => p.id === tempId ? { ...p, id: row.id } : p) } : f));
    } catch (e) { setDataError("No se pudo guardar el entreno en el servidor."); }
  };

  const deleteFolder = async (folderId) => {
    setFolders(fs => fs.filter(f => f.id !== folderId));
    setView({ screen: "home" });
    try { await sb.remove("folders", folderId); } catch (e) { setDataError("No se pudo eliminar en el servidor."); }
  };

  const deleteProject = async (folderId, projectId) => {
    setFolders(fs => fs.map(f => f.id === folderId ? { ...f, projects: f.projects.filter(p => p.id !== projectId) } : f));
    setView({ screen: "folder", folderId });
    try { await sb.remove("projects", projectId); } catch (e) { setDataError("No se pudo eliminar en el servidor."); }
  };

  const renameFolder = async (folderId, name) => {
    setFolders(fs => fs.map(f => f.id === folderId ? { ...f, name } : f));
    try { await sb.update("folders", folderId, { name }); } catch (e) { setDataError("No se pudo renombrar en el servidor."); }
  };

  const renameProject = async (folderId, projectId, name) => {
    setFolders(fs => fs.map(f => f.id === folderId ? { ...f, projects: f.projects.map(p => p.id === projectId ? { ...p, name } : p) } : f));
    try { await sb.update("projects", projectId, { name }); } catch (e) { setDataError("No se pudo renombrar en el servidor."); }
  };

  const projectSaveTimers = useRef({});
  const updateProject = useCallback((folderId, projectId, updater) => {
    setFolders(fs => fs.map(f => f.id === folderId ? {
      ...f, projects: f.projects.map(p => p.id === projectId ? updater(p) : p)
    } : f));

    clearTimeout(projectSaveTimers.current[projectId]);
    projectSaveTimers.current[projectId] = setTimeout(async () => {
      setFolders(curr => {
        const folder = curr.find(f => f.id === folderId);
        const proj = folder?.projects.find(p => p.id === projectId);
        if (proj) {
          sb.update("projects", projectId, { notes: proj.notes, arrows: proj.arrows, strokes: proj.strokes, cones: proj.cones })
            .catch(() => setDataError("No se pudieron sincronizar los últimos cambios."));
        }
        return curr;
      });
    }, 600);
  }, []);

  const closeModal = () => { setModal(null); setInputValue(""); };
  const confirmNewFolder = () => {
    const val = inputValue.trim();
    if (!val) return closeModal();
    addFolder(val);
    closeModal();
  };
  const confirmRename = () => {
    const val = inputValue.trim();
    if (!val) return closeModal();
    if (modal.type === "renameFolder") renameFolder(modal.folderId, val);
    if (modal.type === "renameProject") renameProject(modal.folderId, modal.projectId, val);
    closeModal();
  };
  const confirmNewProject = (sport) => {
    const val = inputValue.trim() || (sport === "padel" ? "Nueva pista de pádel" : "Nueva pista de tenis");
    addProject(modal.folderId, val, sport);
    closeModal();
  };

  const currentFolder = view.screen !== "home" ? folders.find(f => f.id === view.folderId) : null;
  const currentProject = view.screen === "project" ? currentFolder?.projects.find(p => p.id === view.projectId) : null;

  if (authState === "loading") {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={28} />
      </div>
    );
  }

  if (authState === "signedOut" || authState === "linkSent") {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 w-full max-w-sm">
          <div className="flex items-center justify-center mb-4"><img src="/tedel-logo.png" alt="Tedel" className="h-12 w-auto" /></div>
          <h1 className="text-lg font-bold text-slate-800 text-center mb-1">Pádel & Tenis Coach</h1>
          <p className="text-sm text-slate-500 text-center mb-6">Pizarras tácticas para entrenadores</p>

          {authState === "signedOut" && (
            <>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Tu nombre</label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 mb-3">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre" className="flex-1 text-sm outline-none" />
              </div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Tu email</label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 mb-3">
                <Mail size={16} className="text-slate-400" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendLink()} placeholder="tu@email.com" className="flex-1 text-sm outline-none" />
              </div>
              {authError && <p className="text-xs text-red-500 mb-3">{authError}</p>}
              <button onClick={sendLink} disabled={authBusy}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2">
                {authBusy ? <Loader2 size={16} className="animate-spin" /> : null}
                Enviar enlace de acceso
              </button>
              <p className="text-xs text-slate-400 text-center mt-3">Te enviaremos un enlace de un solo uso, sin contraseñas.</p>
            </>
          )}

          {authState === "linkSent" && (
            <>
              <div className="flex items-center justify-center mb-3">
                <Mail size={36} className="text-emerald-500" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-slate-600 text-center mb-1">Hemos enviado un enlace a</p>
              <p className="text-sm font-semibold text-slate-800 text-center mb-4">{linkSentTo}</p>
              <p className="text-xs text-slate-500 text-center mb-4">
                Abre tu correo <strong>desde este mismo dispositivo</strong> y pulsa el enlace para entrar. Revisa también la carpeta de spam.
              </p>
              <p className="text-xs text-amber-600 text-center mb-3">
                ¿Email equivocado? Pulsa abajo para escribir uno nuevo — el enlace anterior dejará de ser necesario.
              </p>
              <button
                onClick={() => { setAuthState("signedOut"); setAuthError(""); setEmail(""); setName(""); }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-lg"
              >
                Usar otro email
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 flex flex-col font-sans" style={{ height: "100vh", maxHeight: "100vh", width: "100%", overflow: "hidden" }}>
      {dataError && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-700 text-xs px-3 py-2 flex items-center justify-between">
          <span>{dataError}</span>
          <button onClick={() => setDataError("")} className="ml-2"><X size={14} /></button>
        </div>
      )}

      {!dataLoaded && (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={24} /></div>
      )}

      {dataLoaded && view.screen === "home" && (
        <HomeScreen
          folders={folders} userName={user?.user_metadata?.full_name} userEmail={user?.email}
          onOpenFolder={(id) => setView({ screen: "folder", folderId: id })}
          onNewFolder={() => {
            if (plan === "free" && folders.length >= FREE_MAX_FOLDERS) {
              setModal({ type: "upgrade", reason: "folders" });
            } else {
              setModal({ type: "newFolder" });
            }
          }}
          onDeleteFolder={deleteFolder}
          onRenameFolder={(id, name) => { setModal({ type: "renameFolder", folderId: id }); setInputValue(name); }}
          onSignOut={doSignOut}
        />
      )}

      {dataLoaded && view.screen === "folder" && currentFolder && (
        <FolderScreen
          folder={currentFolder}
          onBack={() => setView({ screen: "home" })}
          onOpenProject={(id) => setView({ screen: "project", folderId: currentFolder.id, projectId: id })}
          onNewProject={() => {
            if (plan === "free" && currentFolder.projects.length >= FREE_MAX_PROJECTS_PER_FOLDER) {
              setModal({ type: "upgrade", reason: "projects" });
            } else {
              setModal({ type: "newProject", folderId: currentFolder.id, step: "choose" });
            }
          }}
          onDeleteProject={(pid) => deleteProject(currentFolder.id, pid)}
          onRenameProject={(pid, name) => { setModal({ type: "renameProject", folderId: currentFolder.id, projectId: pid }); setInputValue(name); }}
        />
      )}

      {dataLoaded && view.screen === "project" && currentProject && (
        <ProjectScreen
          project={currentProject}
          tool={tool} setTool={setTool} color={color} setColor={setColor}
          showColorPicker={showColorPicker} setShowColorPicker={setShowColorPicker}
          selectedArrowId={selectedArrowId} setSelectedArrowId={setSelectedArrowId}
          onBack={() => { setSelectedArrowId(null); setView({ screen: "folder", folderId: currentFolder.id }); }}
          onChange={(updater) => updateProject(currentFolder.id, currentProject.id, updater)}
        />
      )}

      {modal?.type === "newFolder" && (
        <Modal title="Nueva carpeta" value={inputValue} setValue={setInputValue} onConfirm={confirmNewFolder} onCancel={closeModal} />
      )}
      {(modal?.type === "renameFolder" || modal?.type === "renameProject") && (
        <Modal title={modal.type === "renameFolder" ? "Renombrar carpeta" : "Renombrar entreno"} value={inputValue} setValue={setInputValue} onConfirm={confirmRename} onCancel={closeModal} />
      )}
      {modal?.type === "newProject" && (
        <NewProjectModal value={inputValue} setValue={setInputValue} onChoose={confirmNewProject} onCancel={closeModal} />
      )}
      {modal?.type === "upgrade" && (
        <UpgradeModal reason={modal.reason} onCancel={closeModal} />
      )}
    </div>
  );
}

// =============== MODAL DE LÍMITE FREE / UPGRADE ===============
function UpgradeModal({ reason, onCancel }) {
  const text = reason === "folders"
    ? `Tu plan gratuito permite hasta ${FREE_MAX_FOLDERS} carpetas. Pásate a premium para crear carpetas sin límite.`
    : `Tu plan gratuito permite hasta ${FREE_MAX_PROJECTS_PER_FOLDER} entrenos por carpeta. Pásate a premium para crear entrenos sin límite.`;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm">
        <h3 className="text-base font-bold text-slate-800 mb-2">Has llegado al límite del plan gratuito</h3>
        <p className="text-sm text-slate-600 mb-5">{text}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-lg">
            Ahora no
          </button>
          <button
            onClick={() => { /* TODO: aquí conectaremos el checkout de Stripe en el siguiente paso */ onCancel(); }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 rounded-lg"
          >
            Hazte premium
          </button>
        </div>
      </div>
    </div>
  );
}

// =============== HOME SCREEN ===============
function HomeScreen({ folders, userName, userEmail, onOpenFolder, onNewFolder, onDeleteFolder, onRenameFolder, onSignOut }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-5 py-4 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 tracking-tight"><img src="/tedel-logo.png" alt="Tedel" className="h-6 w-auto" /> Pádel & Tenis Coach</h1>
          {(userName || userEmail) && <p className="text-xs text-slate-400">{userName || userEmail}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onNewFolder} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
            <FolderPlus size={16} /> Carpeta
          </button>
          <button onClick={onSignOut} title="Cerrar sesión" className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {folders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 py-16">
            <Folder size={48} strokeWidth={1.5} />
            <p className="text-sm">Todavía no tienes carpetas.</p>
            <p className="text-xs">Crea una para empezar a organizar tus pizarras tácticas.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {folders.map(folder => (
              <div key={folder.id} onClick={() => onOpenFolder(folder.id)}
                className="group relative bg-white rounded-xl border border-slate-200 p-4 flex flex-col items-center gap-2 cursor-pointer hover:border-emerald-400 hover:shadow-md transition-all">
                <Folder size={36} className="text-emerald-500" strokeWidth={1.5} />
                <span className="text-sm font-medium text-slate-700 text-center line-clamp-2">{folder.name}</span>
                <span className="text-xs text-slate-400">{folder.projects.length} entreno{folder.projects.length !== 1 ? "s" : ""}</span>
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onRenameFolder(folder.id, folder.name); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-md text-slate-500"><Pencil size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar la carpeta "${folder.name}" y todo su contenido?`)) onDeleteFolder(folder.id); }} className="p-1.5 bg-slate-100 hover:bg-red-100 rounded-md text-slate-500 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============== FOLDER SCREEN ===============
function FolderScreen({ folder, onBack, onOpenProject, onNewProject, onDeleteProject, onRenameProject }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-3 py-4 bg-white border-b border-slate-200 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ArrowLeft size={18} /></button>
        <h1 className="text-base font-bold text-slate-800 flex-1 truncate">{folder.name}</h1>
        <button onClick={onNewProject} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
          <FilePlus size={16} /> Entreno
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {folder.projects.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 py-16">
            <FilePlus size={48} strokeWidth={1.5} />
            <p className="text-sm">Sin entrenos en esta carpeta.</p>
            <p className="text-xs">Crea uno para empezar a dibujar tu táctica.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {folder.projects.map(project => (
              <div key={project.id} onClick={() => onOpenProject(project.id)}
                className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-emerald-400 hover:shadow-md transition-all">
                <div className={`aspect-[4/5] flex items-center justify-center p-2 ${project.sport === "tenis" ? "bg-orange-50" : "bg-emerald-50"}`}>
                  <MiniCourtPreview sport={project.sport} arrows={project.arrows} strokes={project.strokes} cones={project.cones} />
                </div>
                <div className="p-2 text-center">
                  <span className="text-sm font-medium text-slate-700 line-clamp-1">{project.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400 block">{project.sport === "tenis" ? "Tenis" : "Pádel"}</span>
                </div>
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onRenameProject(project.id, project.name); }} className="p-1.5 bg-white/90 hover:bg-slate-200 rounded-md text-slate-500 shadow-sm"><Pencil size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar el entreno "${project.name}"?`)) onDeleteProject(project.id); }} className="p-1.5 bg-white/90 hover:bg-red-100 rounded-md text-slate-500 hover:text-red-500 shadow-sm"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniCourtPreview({ sport, arrows, strokes, cones }) {
  return (
    <svg viewBox="0 0 200 320" className="w-full h-full">
      {sport === "tenis" ? <TennisCourtLines w={200} h={320} /> : <PadelCourtLines w={200} h={320} />}
      {strokes.map(s => (
        <polyline key={s.id} points={s.points.map(p => `${p.x * 200},${p.y * 320}`).join(" ")}
          fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {arrows.map(a => (
        <ArrowSvg key={a.id} x1={a.x1 * 200} y1={a.y1 * 320} x2={a.x2 * 200} y2={a.y2 * 320} color={a.color} strokeWidth={2} headSize={6} />
      ))}
      {(cones || []).map(c => (
        <ConeSvg key={c.id} x={c.x * 200} y={c.y * 320} color={c.color} size={200 * CONE_SIZE_RATIO} />
      ))}
    </svg>
  );
}

// =============== COURT LINES ===============
function PadelCourtLines({ w, h }) {
  const stroke = "#0f766e";
  const strokeWidth = 2;
  const netY = h * 0.5;
  const serviceTop = h * 0.18;
  const serviceBottom = h * 0.82;
  const midX = w * 0.5;
  return (
    <g>
      <rect x={2} y={2} width={w - 4} height={h - 4} fill="#10b981" fillOpacity={0.18} stroke={stroke} strokeWidth={strokeWidth} rx={4} />
      <line x1={2} y1={netY} x2={w - 2} y2={netY} stroke={stroke} strokeWidth={strokeWidth + 1} />
      <line x1={2} y1={serviceTop} x2={w - 2} y2={serviceTop} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={2} y1={serviceBottom} x2={w - 2} y2={serviceBottom} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={serviceTop} x2={midX} y2={netY} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={netY} x2={midX} y2={serviceBottom} stroke={stroke} strokeWidth={strokeWidth} />
    </g>
  );
}

function TennisCourtLines({ w, h }) {
  const stroke = "#fef3c7";
  const strokeWidth = 2;
  const pad = 2;
  const courtW = w - pad * 2;
  const courtH = h - pad * 2;
  const singlesInsetX = courtW * (1.37 / 10.97);
  const singlesLeft = pad + singlesInsetX;
  const singlesRight = w - pad - singlesInsetX;
  const netY = h * 0.5;
  const serviceTop = netY - courtH * (6.4 / 23.77);
  const serviceBottom = netY + courtH * (6.4 / 23.77);
  const midX = w / 2;

  return (
    <g>
      <rect x={pad} y={pad} width={courtW} height={courtH} fill="#c2410c" fillOpacity={0.85} stroke={stroke} strokeWidth={strokeWidth} rx={4} />
      <line x1={singlesLeft} y1={pad} x2={singlesLeft} y2={h - pad} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={singlesRight} y1={pad} x2={singlesRight} y2={h - pad} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={pad} y1={netY} x2={w - pad} y2={netY} stroke={stroke} strokeWidth={strokeWidth + 1.5} />
      <line x1={singlesLeft} y1={serviceTop} x2={singlesRight} y2={serviceTop} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={singlesLeft} y1={serviceBottom} x2={singlesRight} y2={serviceBottom} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={serviceTop} x2={midX} y2={netY} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={netY} x2={midX} y2={serviceBottom} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={pad} x2={midX} y2={pad + 6} stroke={stroke} strokeWidth={strokeWidth} />
      <line x1={midX} y1={h - pad} x2={midX} y2={h - pad - 6} stroke={stroke} strokeWidth={strokeWidth} />
    </g>
  );
}

function ArrowSvg({ x1, y1, x2, y2, color, strokeWidth = 3, headSize = 10, selected }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const hx1 = x2 - headSize * Math.cos(angle - Math.PI / 6);
  const hy1 = y2 - headSize * Math.sin(angle - Math.PI / 6);
  const hx2 = x2 - headSize * Math.cos(angle + Math.PI / 6);
  const hy2 = y2 - headSize * Math.sin(angle + Math.PI / 6);
  return (
    <g>
      {selected && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3b82f6" strokeWidth={strokeWidth + 6} strokeLinecap="round" opacity={0.3} />}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={color} />
      {selected && (
        <>
          <circle cx={x1} cy={y1} r={6} fill="white" stroke="#3b82f6" strokeWidth={2} />
          <circle cx={x2} cy={y2} r={6} fill="white" stroke="#3b82f6" strokeWidth={2} />
        </>
      )}
    </g>
  );
}

// Un cono de entrenamiento real mide ~20cm de base. Una pista de pádel mide 10m de largo.
// 0.2 / 10 = 2% del largo de la pista. Lo usamos como referencia de tamaño (proporción
// del lado más largo del campo de juego, VB_H), igual para pádel y tenis.
const CONE_SIZE_RATIO = 0.033;

function ConeSvg({ x, y, color, size = 10, selected }) {
  const halfBase = size * 0.5;
  const topY = y - size * 0.95;
  return (
    <g>
      {selected && <circle cx={x} cy={y} r={size * 0.9} fill="#3b82f6" opacity={0.25} />}
      {/* sombra/base elíptica */}
      <ellipse cx={x} cy={y} rx={halfBase} ry={halfBase * 0.38} fill={color} opacity={0.9} />
      {/* cuerpo del cono */}
      <polygon
        points={`${x - halfBase * 0.78},${y} ${x + halfBase * 0.78},${y} ${x},${topY}`}
        fill={color}
      />
      {/* franja clara, como los conos reales */}
      <polygon
        points={`${x - halfBase * 0.45},${y - size * 0.32} ${x + halfBase * 0.45},${y - size * 0.32} ${x + halfBase * 0.27},${y - size * 0.5} ${x - halfBase * 0.27},${y - size * 0.5}`}
        fill="white" opacity={0.85}
      />
      {selected && <circle cx={x} cy={y} r={5} fill="white" stroke="#3b82f6" strokeWidth={2} />}
    </g>
  );
}

// =============== PROJECT SCREEN ===============
const VB_W = 300;
const VB_H = 480;

function ProjectScreen({ project, tool, setTool, color, setColor, showColorPicker, setShowColorPicker, selectedArrowId, setSelectedArrowId, onBack, onChange }) {
  const svgRef = useRef(null);
  const courtWrapRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const isTenis = project.sport === "tenis";
  const cones = project.cones || [];

  // Convierte coordenadas de pantalla a coordenadas normalizadas (0-1) dentro del SVG,
  // usando la matriz de transformación nativa del navegador (getScreenCTM). Esto es
  // exacto siempre, sin necesidad de calcular manualmente offsets ni aspect-ratios.
  const getSvgPoint = (e) => {
    const svg = svgRef.current;
    const touch = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);

    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inverse = ctm.inverse();
    const pt = new DOMPoint(touch.clientX, touch.clientY).matrixTransform(inverse);

    return {
      x: Math.max(0, Math.min(1, pt.x / VB_W)),
      y: Math.max(0, Math.min(1, pt.y / VB_H)),
    };
  };

  const hitTestArrow = (pt) => {
    const thresh = 0.04;
    for (let i = project.arrows.length - 1; i >= 0; i--) {
      const a = project.arrows[i];
      const d1 = Math.hypot(pt.x - a.x1, pt.y - a.y1);
      const d2 = Math.hypot(pt.x - a.x2, pt.y - a.y2);
      if (d1 < thresh) return { id: a.id, which: "start" };
      if (d2 < thresh) return { id: a.id, which: "end" };
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((pt.x - a.x1) * dx + (pt.y - a.y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x1 + t * dx, py = a.y1 + t * dy;
      if (Math.hypot(pt.x - px, pt.y - py) < thresh) return { id: a.id, which: "body" };
    }
    return null;
  };

  const hitTestCone = (pt) => {
    const thresh = CONE_SIZE_RATIO * 1.6;
    for (let i = cones.length - 1; i >= 0; i--) {
      const c = cones[i];
      const dx = pt.x - c.x;
      const dy = (pt.y - c.y) * (VB_H / VB_W); // compensar proporción no cuadrada del viewBox
      if (Math.hypot(dx, dy) < thresh) return c.id;
    }
    return null;
  };

  const hitTestStroke = (pt) => {
    const thresh = 0.04;
    for (let i = project.strokes.length - 1; i >= 0; i--) {
      const s = project.strokes[i];
      for (const p of s.points) {
        if (Math.hypot(pt.x - p.x, pt.y - p.y) < thresh) return s.id;
      }
    }
    return null;
  };

  const [selectedConeId, setSelectedConeId] = useState(null);

  const handleStart = (e) => {
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (tool === "select") {
      const coneHit = hitTestCone(pt);
      if (coneHit) {
        setSelectedConeId(coneHit);
        setSelectedArrowId(null);
        setDrag({ type: "cone-move", id: coneHit, lastX: pt.x, lastY: pt.y });
        return;
      }
      const hit = hitTestArrow(pt);
      if (hit) {
        setSelectedArrowId(hit.id);
        setSelectedConeId(null);
        if (hit.which === "start" || hit.which === "end") setDrag({ type: "arrow-handle", id: hit.id, which: hit.which });
        else setDrag({ type: "arrow-move", id: hit.id, lastX: pt.x, lastY: pt.y });
      } else { setSelectedArrowId(null); setSelectedConeId(null); }
      return;
    }
    if (tool === "arrow") {
      setSelectedArrowId(null); setSelectedConeId(null);
      setDrag({ type: "arrow-create", x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      return;
    }
    if (tool === "cone") {
      setSelectedArrowId(null);
      const newCone = { id: uid(), x: pt.x, y: pt.y, color };
      onChange(p => ({ ...p, cones: [...(p.cones || []), newCone] }));
      setSelectedConeId(newCone.id);
      setDrag(null);
      return;
    }
    if (tool === "draw") {
      setSelectedArrowId(null); setSelectedConeId(null);
      const newStroke = { id: uid(), color, points: [pt] };
      onChange(p => ({ ...p, strokes: [...p.strokes, newStroke] }));
      setDrag({ type: "draw", strokeId: newStroke.id });
      return;
    }
    if (tool === "erase") {
      const sHit = hitTestStroke(pt);
      if (sHit) onChange(p => ({ ...p, strokes: p.strokes.filter(s => s.id !== sHit) }));
      const aHit = hitTestArrow(pt);
      if (aHit) onChange(p => ({ ...p, arrows: p.arrows.filter(a => a.id !== aHit.id) }));
      const cHit = hitTestCone(pt);
      if (cHit) onChange(p => ({ ...p, cones: (p.cones || []).filter(c => c.id !== cHit) }));
      setDrag({ type: "erase" });
      return;
    }
  };

  const handleMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    if (drag.type === "arrow-create") { setDrag(d => ({ ...d, x2: pt.x, y2: pt.y })); return; }
    if (drag.type === "arrow-handle") {
      onChange(p => ({ ...p, arrows: p.arrows.map(a => a.id === drag.id ? (drag.which === "start" ? { ...a, x1: pt.x, y1: pt.y } : { ...a, x2: pt.x, y2: pt.y }) : a) }));
      return;
    }
    if (drag.type === "arrow-move") {
      const dx = pt.x - drag.lastX, dy = pt.y - drag.lastY;
      onChange(p => ({ ...p, arrows: p.arrows.map(a => a.id === drag.id ? { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } : a) }));
      setDrag(d => ({ ...d, lastX: pt.x, lastY: pt.y }));
      return;
    }
    if (drag.type === "cone-move") {
      const dx = pt.x - drag.lastX, dy = pt.y - drag.lastY;
      onChange(p => ({ ...p, cones: (p.cones || []).map(c => c.id === drag.id ? { ...c, x: c.x + dx, y: c.y + dy } : c) }));
      setDrag(d => ({ ...d, lastX: pt.x, lastY: pt.y }));
      return;
    }
    if (drag.type === "draw") {
      onChange(p => ({ ...p, strokes: p.strokes.map(s => s.id === drag.strokeId ? { ...s, points: [...s.points, pt] } : s) }));
      return;
    }
    if (drag.type === "erase") {
      const sHit = hitTestStroke(pt);
      if (sHit) onChange(p => ({ ...p, strokes: p.strokes.filter(s => s.id !== sHit) }));
      const aHit = hitTestArrow(pt);
      if (aHit) onChange(p => ({ ...p, arrows: p.arrows.filter(a => a.id !== aHit.id) }));
      const cHit = hitTestCone(pt);
      if (cHit) onChange(p => ({ ...p, cones: (p.cones || []).filter(c => c.id !== cHit) }));
      return;
    }
  };

  const handleEnd = () => {
    if (drag?.type === "arrow-create") {
      const dist = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
      if (dist > 0.02) {
        const newArrow = { id: uid(), x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2, color };
        onChange(p => ({ ...p, arrows: [...p.arrows, newArrow] }));
      }
    }
    setDrag(null);
  };

  const deleteSelectedArrow = () => {
    if (selectedArrowId) {
      onChange(p => ({ ...p, arrows: p.arrows.filter(a => a.id !== selectedArrowId) }));
      setSelectedArrowId(null);
    }
    if (selectedConeId) {
      onChange(p => ({ ...p, cones: (p.cones || []).filter(c => c.id !== selectedConeId) }));
      setSelectedConeId(null);
    }
  };

  const recolorSelectedCone = (newColor) => {
    if (!selectedConeId) return;
    onChange(p => ({ ...p, cones: (p.cones || []).map(c => c.id === selectedConeId ? { ...c, color: newColor } : c) }));
  };

  const clearAll = () => {
    if (confirm("¿Borrar todos los dibujos, flechas y conos de esta pista?")) {
      onChange(p => ({ ...p, arrows: [], strokes: [], cones: [] }));
      setSelectedArrowId(null);
      setSelectedConeId(null);
    }
  };

  // ---- Panel de notas: se abre/cierra con el botón "A" de la barra de herramientas ----

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" style={{ height: "100%", maxHeight: "100%" }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b border-slate-200 flex-wrap" style={{ flex: "0 0 auto", position: "sticky", top: 0, zIndex: 30 }}>
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 flex-shrink-0"><ArrowLeft size={16} /></button>
        <h1 className="text-sm font-bold text-slate-800 flex-1 truncate min-w-0">{project.name}</h1>
        <ToolBtn icon={MousePointer2} active={tool === "select"} onClick={() => setTool("select")} compact />
        <ToolBtn icon={MoveRight} active={tool === "arrow"} onClick={() => setTool("arrow")} compact />
        <ToolBtn icon={Triangle} active={tool === "cone"} onClick={() => setTool("cone")} compact />
        <ToolBtn icon={Pencil} active={tool === "draw"} onClick={() => setTool("draw")} compact />
        <ToolBtn icon={Eraser} active={tool === "erase"} onClick={() => setTool("erase")} compact />
        <button
          onClick={() => setNotesOpen(o => !o)}
          className={`px-2 py-1.5 rounded-lg flex-shrink-0 text-sm font-bold ${notesOpen ? "bg-emerald-600 text-white" : "hover:bg-slate-100 text-slate-600"}`}
          title="Anotaciones"
        >
          A
        </button>
        <button onClick={() => setShowColorPicker(s => !s)} className="relative p-1.5 rounded-lg hover:bg-slate-100 flex-shrink-0">
          <span className="w-4 h-4 rounded-full border border-slate-300 block" style={{ backgroundColor: color }} />
        </button>
        {(selectedArrowId || selectedConeId) && (
          <button onClick={deleteSelectedArrow} className="p-1.5 rounded-lg bg-red-50 text-red-500 flex-shrink-0"><Trash2 size={14} /></button>
        )}
        <button onClick={clearAll} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 flex-shrink-0"><Trash2 size={16} /></button>
      </div>

      {showColorPicker && (
        <div className="px-2 py-1.5 bg-white border-b border-slate-200 flex items-center gap-2" style={{ flex: "0 0 auto" }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => { setColor(c); if (selectedConeId) recolorSelectedCone(c); setShowColorPicker(false); }}
              className="w-6 h-6 rounded-full border-2 transition-transform"
              style={{ backgroundColor: c, borderColor: c === color ? "#0f172a" : "transparent", transform: c === color ? "scale(1.15)" : "scale(1)" }} />
          ))}
        </div>
      )}

      <div
        ref={courtWrapRef}
        className={`flex items-center justify-center p-1 ${isTenis ? "bg-orange-100" : "bg-slate-100"}`}
        style={{ flex: notesOpen ? "0 0 52%" : "1 1 auto", minHeight: 0, overflow: "hidden" }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="rounded-md shadow-sm select-none touch-none"
          style={{ width: "100%", height: "100%", maxWidth: `calc(${notesOpen ? "42vh" : "70vh"} * ${VB_W / VB_H})`, aspectRatio: `${VB_W}/${VB_H}` }}
          onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
          onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
        >
          {isTenis ? <TennisCourtLines w={VB_W} h={VB_H} /> : <PadelCourtLines w={VB_W} h={VB_H} />}
          <image
            href="/tedel-watermark.png"
            x={VB_W / 2 - VB_W * 0.17}
            y={VB_H / 2 - VB_W * 0.17}
            width={VB_W * 0.34}
            height={VB_W * 0.34}
            opacity={0.08}
            style={{ pointerEvents: "none" }}
            preserveAspectRatio="xMidYMid meet"
          />
          {project.strokes.map(s => (
            <polyline key={s.id} points={s.points.map(p => `${p.x * VB_W},${p.y * VB_H}`).join(" ")}
              fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {project.arrows.map(a => (
            <g key={a.id} onClick={() => tool === "select" && setSelectedArrowId(a.id)}>
              <ArrowSvg x1={a.x1 * VB_W} y1={a.y1 * VB_H} x2={a.x2 * VB_W} y2={a.y2 * VB_H} color={a.color} strokeWidth={3.5} headSize={12} selected={selectedArrowId === a.id} />
            </g>
          ))}
          {cones.map(c => (
            <ConeSvg key={c.id} x={c.x * VB_W} y={c.y * VB_H} color={c.color} size={VB_W * CONE_SIZE_RATIO} selected={selectedConeId === c.id} />
          ))}
          {drag?.type === "arrow-create" && (
            <ArrowSvg x1={drag.x1 * VB_W} y1={drag.y1 * VB_H} x2={drag.x2 * VB_W} y2={drag.y2 * VB_H} color={color} strokeWidth={3.5} headSize={12} />
          )}
        </svg>
      </div>

      {notesOpen && (
        <div
          className="border-t border-slate-200 bg-white flex flex-col"
          style={{ flex: "0 0 48%", minHeight: 0, overflow: "hidden" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 flex-shrink-0">
            <label className="text-xs font-semibold text-slate-500">Anotaciones</label>
            <button onClick={() => setNotesOpen(false)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100">
              <X size={12} /> Cerrar
            </button>
          </div>
          <div className="px-3 pb-3 pt-2 flex-1 min-h-0 flex flex-col">
            <textarea
              value={project.notes}
              onChange={(e) => onChange(p => ({ ...p, notes: e.target.value }))}
              placeholder="Escribe aquí tus notas sobre esta jugada o ejercicio..."
              className="w-full flex-1 resize-none border border-slate-200 rounded-lg p-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ icon: Icon, active, onClick, label, compact }) {
  if (compact) {
    return (
      <button onClick={onClick} className={`p-1.5 rounded-lg flex-shrink-0 ${active ? "bg-emerald-600 text-white" : "hover:bg-slate-100 text-slate-600"}`}>
        <Icon size={16} />
      </button>
    );
  }
  return (
    <button onClick={onClick} title={label}
      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${active ? "bg-emerald-600 text-white" : "hover:bg-slate-100 text-slate-600"}`}>
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// =============== MODALES ===============
function Modal({ title, value, setValue, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl p-4 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); if (e.key === "Escape") onCancel(); }}
          placeholder="Nombre..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-lg flex items-center gap-1"><X size={14} /> Cancelar</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1"><Check size={14} /> Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function NewProjectModal({ value, setValue, onChoose, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl p-4 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Nuevo entreno</h3>
        <label className="text-xs font-semibold text-slate-500 mb-1 block">Nombre (opcional)</label>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="Ej: Saque y volea"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        <label className="text-xs font-semibold text-slate-500 mb-2 block">¿Qué deporte?</label>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <button onClick={() => onChoose("padel")} className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:border-emerald-500 transition-colors">
            <svg viewBox="0 0 100 160" className="w-14 h-20"><PadelCourtLines w={100} h={160} /></svg>
            <span className="text-sm font-semibold text-emerald-700">Pádel</span>
          </button>
          <button onClick={() => onChoose("tenis")} className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-orange-200 bg-orange-50 hover:border-orange-500 transition-colors">
            <svg viewBox="0 0 100 160" className="w-14 h-20"><TennisCourtLines w={100} h={160} /></svg>
            <span className="text-sm font-semibold text-orange-700">Tenis</span>
          </button>
        </div>
        <button onClick={onCancel} className="w-full mt-2 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-lg flex items-center justify-center gap-1"><X size={14} /> Cancelar</button>
      </div>
    </div>
  );
}