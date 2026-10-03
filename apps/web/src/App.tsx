import { FormEvent, useEffect, useState } from 'react';
import {
  Activity, Archive, BriefcaseBusiness, Building2, ChevronRight, CircleUserRound, FileKey2, Gauge, KeyRound, LogOut,
  MapPin, Menu, RefreshCw, Search, Settings, ShieldCheck, UserPlus, Users, X, Layers3
} from 'lucide-react';
import { api, ApiError } from './api';
import { ClientsPage, EstablishmentsPage, ProjectsPage } from './stage2';
import { Stage3Page } from './stage3';

type UserSession = { id: string; email: string; fullName: string; permissions: string[] };
type Section = 'overview' | 'clients' | 'establishments' | 'projects' | 'infrastructure' | 'users' | 'roles' | 'audit' | 'settings' | 'storage';
type Summary = { users: number; roles: number; events24h: number; files: number; clients: number; establishments: number; activeProjects: number; buildings: number; floors: number; readyPlans: number };
type Role = { id: string; code: string; name: string; description: string; isSystem: boolean; permissions: string[]; userCount: number };
type UserRow = { id: string; email: string; fullName: string; status: 'active' | 'suspended'; lastLoginAt: string | null; createdAt: string; roles: { id: string; name: string }[] };
type AuditEvent = { id: number; action: string; entityType: string; entityId: string | null; outcome: string; occurredAt: string; actorName: string | null; actorEmail: string | null; metadata: Record<string, unknown> };

const nav: { id: Section; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'Resumen', icon: Gauge },
  { id: 'clients', label: 'Clientes', icon: Building2 },
  { id: 'establishments', label: 'Establecimientos', icon: MapPin },
  { id: 'projects', label: 'Proyectos', icon: BriefcaseBusiness },
  { id: 'infrastructure', label: 'Edificios y plantas', icon: Layers3 },
  { id: 'users', label: 'Usuarios', icon: Users },
  { id: 'roles', label: 'Roles y permisos', icon: ShieldCheck },
  { id: 'storage', label: 'Almacenamiento', icon: Archive },
  { id: 'audit', label: 'Auditoría', icon: Activity },
  { id: 'settings', label: 'Configuración', icon: Settings }
];

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value))
  : 'Sin registro';

function Login({ onLogin }: { onLogin: (user: UserSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      const response = await api<{ user: UserSession }>('/auth/me');
      onLogin(response.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible iniciar sesión.');
    } finally { setBusy(false); }
  }

  return <main className="login-shell">
    <section className="login-brand" aria-label="Identidad JR">
      <div className="brand-line" />
      <img src="/logo-jr.jpg" alt="JR Gestión Integral S.A.S." />
      <div className="brand-copy">
        <span>SAFE ENTER 360</span>
        <h1>Gestión segura,<br />trazable y confiable.</h1>
        <p>Subfase 4.0 · Planos privados, archivos validados y versiones protegidas.</p>
      </div>
      <small>JR Gestión Integral S.A.S. · Barranquilla, Colombia</small>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><ShieldCheck size={26} /><span>Acceso protegido</span></div>
        <h2>Bienvenida</h2>
        <p className="muted">Ingresa con tu cuenta autorizada de JR.</p>
        <label>Correo corporativo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="nombre@empresa.com" /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••••••" /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="primary wide" disabled={busy}>{busy ? <><RefreshCw className="spin" size={18} /> Verificando</> : <>Ingresar <ChevronRight size={19} /></>}</button>
        <div className="security-note"><KeyRound size={16} /><span>Sesión cifrada, acceso por permisos y actividad auditada.</span></div>
      </form>
    </section>
  </main>;
}

function Overview() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Summary>('/platform/summary').then(setData).catch((e) => setError(e.message)); }, []);
  const stats = [
    { label: 'Clientes activos', value: data?.clients, icon: Building2 },
    { label: 'Establecimientos activos', value: data?.establishments, icon: MapPin },
    { label: 'Proyectos en curso', value: data?.activeProjects, icon: BriefcaseBusiness },
    { label: 'Edificios activos', value: data?.buildings, icon: Building2 },
    { label: 'Plantas activas', value: data?.floors, icon: Layers3 },
    { label: 'Planos vigentes', value: data?.readyPlans, icon: FileKey2 },
    { label: 'Usuarios registrados', value: data?.users, icon: Users },
    { label: 'Roles configurados', value: data?.roles, icon: ShieldCheck },
    { label: 'Eventos en 24 horas', value: data?.events24h, icon: Activity },
    { label: 'Archivos registrados', value: data?.files, icon: Archive }
  ];
  return <>
    <header className="page-heading"><div><p className="eyebrow">Estado de la plataforma</p><h2>SAFE ENTER 360</h2><p>Control central de proyectos, edificios, plantas, planos y seguridad.</p></div><span className="status-pill"><i /> Operativa</span></header>
    {error && <div className="alert error">{error}</div>}
    <div className="stats-grid">{stats.map(({ label, value, icon: Icon }) => <article className="stat-card" key={label}><Icon size={21} /><strong>{value ?? '—'}</strong><span>{label}</span></article>)}</div>
    <div className="overview-grid">
      <section className="panel readiness">
        <div className="panel-head"><div><h3>Capacidades activas</h3><p>Base de las Etapas 1–3 con las protecciones de la Subfase 4.0.</p></div><span>12 / 12</span></div>
        {['Autenticación y sesiones', 'Roles y permisos', 'Clientes', 'Establecimientos', 'Proyectos', 'Edificios', 'Plantas', 'Planos validados y versionados', 'PostgreSQL + PostGIS', 'Archivos privados protegidos', 'Auditoría de actividad', 'Respaldo integral y recuperación'].map((item) => <div className="check-row" key={item}><ShieldCheck size={18} /><span>{item}</span><b>Listo</b></div>)}
      </section>
      <section className="panel scope-card"><p className="eyebrow">Alcance actual</p><h3>Subfase 4.0 operativa</h3><p>Los planos se validan antes de quedar disponibles. Cada planta conserva una única versión vigente y su historial; reutilizar un enlace de carga no sobrescribe el archivo confirmado.</p><div className="scope-rule" /><small>Editor geométrico, inspecciones, señalización, rutas, IA y BIM permanecen fuera de esta etapa.</small></section>
    </div>
  </>;
}

function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const load = () => Promise.all([api<{ users: UserRow[] }>('/users'), api<{ roles: Role[] }>('/roles')]).then(([u, r]) => { setUsers(u.users); setRoles(r.roles); });
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, []);
  const filtered = users.filter((user) => `${user.fullName} ${user.email}`.toLowerCase().includes(search.toLowerCase()));

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({ email: data.get('email'), fullName: data.get('fullName'), password: data.get('password'), roleIds: [data.get('roleId')] }) });
      setOpen(false); setMessage('Usuario creado correctamente.'); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'No fue posible crear el usuario.'); }
  }

  async function toggle(user: UserRow) {
    const status = user.status === 'active' ? 'suspended' : 'active';
    try { await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'No fue posible cambiar el estado.'); }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">Control de acceso</p><h2>Usuarios</h2><p>Cuentas autorizadas para ingresar a la plataforma.</p></div><button className="primary" onClick={() => setOpen(true)}><UserPlus size={18} /> Nuevo usuario</button></header>
    {message && <div className="alert info">{message}</div>}
    <section className="panel table-panel"><div className="toolbar"><label className="search"><Search size={18} /><input aria-label="Buscar usuarios" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o correo" /></label><span>{filtered.length} usuarios</span></div>
      <div className="table-scroll"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><td><div className="person"><span>{user.fullName.charAt(0)}</span><div><strong>{user.fullName}</strong><small>{user.email}</small></div></div></td><td>{user.roles.map((r) => r.name).join(', ') || 'Sin rol'}</td><td><span className={`badge ${user.status}`}>{user.status === 'active' ? 'Activo' : 'Suspendido'}</span></td><td>{formatDate(user.lastLoginAt)}</td><td><button className="text-button" onClick={() => toggle(user)}>{user.status === 'active' ? 'Suspender' : 'Activar'}</button></td></tr>)}</tbody></table></div>
    </section>
    {open && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-user-title"><button className="icon-button close" onClick={() => setOpen(false)} aria-label="Cerrar"><X /></button><p className="eyebrow">Nueva cuenta</p><h3 id="new-user-title">Crear usuario</h3><form onSubmit={createUser}><label>Nombre completo<input name="fullName" required minLength={3} /></label><label>Correo<input name="email" type="email" required /></label><label>Contraseña temporal<input name="password" type="password" required minLength={12} /><small>Mínimo 12 caracteres.</small></label><label>Rol<select name="roleId" required>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="primary">Crear usuario</button></div></form></section></div>}
  </>;
}

function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<{ code: string; name: string; description: string }[]>([]);
  const [selected, setSelected] = useState<Role | null>(null);
  useEffect(() => { api<{ roles: Role[]; permissions: typeof permissions }>('/roles').then((r) => { setRoles(r.roles); setPermissions(r.permissions); setSelected(r.roles[0] ?? null); }); }, []);
  return <><header className="page-heading"><div><p className="eyebrow">Autorización</p><h2>Roles y permisos</h2><p>Acceso concedido según responsabilidades.</p></div></header><div className="roles-grid"><section className="panel role-list">{roles.map((role) => <button className={selected?.id === role.id ? 'selected' : ''} onClick={() => setSelected(role)} key={role.id}><ShieldCheck size={20} /><span><strong>{role.name}</strong><small>{role.userCount} usuario{role.userCount === 1 ? '' : 's'}</small></span><ChevronRight size={18} /></button>)}</section><section className="panel role-detail">{selected ? <><div className="panel-head"><div><p className="eyebrow">{selected.isSystem ? 'Rol del sistema' : 'Rol personalizado'}</p><h3>{selected.name}</h3><p>{selected.description}</p></div><span className="code">{selected.code}</span></div><div className="permission-list">{permissions.map((permission) => <div key={permission.code} className={selected.permissions.includes(permission.code) ? 'granted' : ''}><span><strong>{permission.name}</strong><small>{permission.description}</small></span><i>{selected.permissions.includes(permission.code) ? 'Concedido' : 'No concedido'}</i></div>)}</div></> : <p>Sin roles configurados.</p>}</section></div></>;
}

function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => { api<{ events: AuditEvent[] }>('/audit?limit=100').then((r) => setEvents(r.events)); }, []);
  const labels: Record<string, string> = { 'auth.login': 'Inicio de sesión', 'auth.logout': 'Cierre de sesión', 'user.create': 'Usuario creado', 'user.status.change': 'Estado de usuario', 'role.create': 'Rol creado', 'settings.update': 'Configuración actualizada', 'file.upload.request': 'Carga solicitada', 'client.create': 'Cliente creado', 'client.update': 'Cliente actualizado', 'client.status.change': 'Estado de cliente', 'establishment.create': 'Establecimiento creado', 'establishment.update': 'Establecimiento actualizado', 'establishment.status.change': 'Estado de establecimiento', 'project.create': 'Proyecto creado', 'project.update': 'Proyecto actualizado', 'project.status.change': 'Estado de proyecto', 'building.create': 'Edificio creado', 'building.update': 'Edificio actualizado', 'building.status.change': 'Estado de edificio', 'floor.create': 'Planta creada', 'floor.update': 'Planta actualizada', 'floor.status.change': 'Estado de planta', 'plan.upload.request': 'Carga de plano solicitada', 'plan.upload.complete': 'Plano cargado', 'plan.download': 'Plano descargado', 'stage3.test.cleanup': 'Datos de prueba eliminados', 'platform.test.cleanup': 'Archivo técnico de prueba eliminado' };
  return <><header className="page-heading"><div><p className="eyebrow">Trazabilidad</p><h2>Auditoría</h2><p>Registro inalterable de accesos y cambios administrativos.</p></div></header><section className="panel audit-list">{events.length === 0 && <div className="empty"><Activity size={30} /><h3>Aún no hay eventos</h3><p>La actividad aparecerá aquí cuando se registren acciones.</p></div>}{events.map((event) => <article key={event.id}><div className={`event-icon ${event.outcome}`}><Activity size={17} /></div><div><strong>{labels[event.action] ?? event.action}</strong><p>{event.actorName ?? event.actorEmail ?? 'Sistema'} · {event.entityType}</p></div><time>{formatDate(event.occurredAt)}</time></article>)}</section></>;
}

function SettingsPage() {
  const [timezone, setTimezone] = useState('America/Bogota'); const [locale, setLocale] = useState('es-CO'); const [sessionNotice, setSessionNotice] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { api<{ settings: { timezone?: string; locale?: string; sessionNotice?: string } }>('/settings').then(({ settings }) => { setTimezone(settings.timezone ?? timezone); setLocale(settings.locale ?? locale); setSessionNotice(settings.sessionNotice ?? ''); }); }, []);
  async function save(event: FormEvent) { event.preventDefault(); try { await api('/settings', { method: 'PUT', body: JSON.stringify({ timezone, locale, sessionNotice }) }); setMessage('Configuración guardada y registrada en auditoría.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'No fue posible guardar.'); } }
  return <><header className="page-heading"><div><p className="eyebrow">Preferencias</p><h2>Configuración</h2><p>Parámetros generales de la organización.</p></div></header><form className="panel settings-form" onSubmit={save}><div className="form-section"><h3>Perfil organizacional</h3><p>Datos que identifican el entorno de trabajo.</p></div><label>Organización<input value="JR Gestión Integral S.A.S." disabled /></label><label>Zona horaria<select value={timezone} onChange={(e) => setTimezone(e.target.value)}><option>America/Bogota</option></select></label><label>Idioma y región<select value={locale} onChange={(e) => setLocale(e.target.value)}><option value="es-CO">Español · Colombia</option></select></label><label className="full">Mensaje para el equipo<textarea value={sessionNotice} onChange={(e) => setSessionNotice(e.target.value)} maxLength={300} placeholder="Aviso opcional para la operación interna" /></label>{message && <div className="alert info full">{message}</div>}<div className="form-actions full"><button className="primary">Guardar cambios</button></div></form></>;
}

function StoragePage() {
  return <><header className="page-heading"><div><p className="eyebrow">Archivos privados</p><h2>Almacenamiento</h2><p>Infraestructura segura compatible con S3 para documentos de la plataforma.</p></div></header><section className="panel storage-card"><div className="storage-icon"><FileKey2 size={32} /></div><div><h3>Protección de planos · Subfase 4.0</h3><p>Las cargas y descargas usan enlaces temporales y acceso por organización. Antes de confirmar cada plano se comprueban su tamaño, formato y contenido.</p><ul><li>PDF, PNG y JPEG validados antes de estar disponibles</li><li>Copia definitiva protegida frente a reutilización del enlace de carga</li><li>Huella SHA-256 para comprobar la integridad del archivo</li><li>Una versión vigente por planta y versiones anteriores conservadas</li><li>API y descargas privadas excluidas de la caché de la aplicación</li><li>Herramientas de respaldo integral: base de datos y archivos; recuperación ensayada</li></ul></div><span className="status-pill"><i /> Disponible</span></section></>;
}

function Shell({ user, onLogout }: { user: UserSession; onLogout: () => void }) {
  const [section, setSection] = useState<Section>('overview'); const [menu, setMenu] = useState(false);
  const title = nav.find((item) => item.id === section)?.label;
  const content: Record<Section, React.ReactNode> = { overview: <Overview />, clients: <ClientsPage />, establishments: <EstablishmentsPage />, projects: <ProjectsPage />, infrastructure: <Stage3Page />, users: <UsersPage />, roles: <RolesPage />, audit: <AuditPage />, settings: <SettingsPage />, storage: <StoragePage /> };
  return <div className="app-shell"><aside className={menu ? 'sidebar open' : 'sidebar'}><button className="mobile-close" aria-label="Cerrar menú" onClick={() => setMenu(false)}><X /></button><div className="sidebar-brand"><img src="/logo-jr.jpg" alt="JR Gestión Integral S.A.S." /><span>SAFE ENTER 360<small>JR Gestión Integral</small></span></div><nav aria-label="Navegación principal">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setMenu(false); }}><Icon size={19} /><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="sidebar-scope"><ShieldCheck size={18} /><span><strong>Subfase 4.0</strong><small>Integridad de planos</small></span></div><button onClick={onLogout}><LogOut size={18} /> Cerrar sesión</button></div></aside>{menu && <button className="menu-scrim" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}<main className="workspace"><div className="topbar"><button className="menu-button" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu /></button><span className="mobile-title">{title}</span><div className="user-chip"><CircleUserRound size={21} /><span><strong>{user.fullName}</strong><small>{user.email}</small></span></div></div><div className="content">{content[section]}</div></main></div>;
}

export default function App() {
  const [user, setUser] = useState<UserSession | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ user: UserSession }>('/auth/me').then((r) => setUser(r.user)).catch((error) => { if (!(error instanceof ApiError && error.status === 401)) console.error(error); }).finally(() => setLoading(false)); }, []);
  async function logout() { try { await api('/auth/logout', { method: 'POST' }); } finally { setUser(null); } }
  if (loading) return <div className="splash"><img src="/logo-jr.jpg" alt="JR Gestión Integral S.A.S." /><RefreshCw className="spin" /></div>;
  return user ? <Shell user={user} onLogout={logout} /> : <Login onLogin={setUser} />;
}
