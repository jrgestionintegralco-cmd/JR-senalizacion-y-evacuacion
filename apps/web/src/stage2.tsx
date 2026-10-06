import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Building2, MapPin, Pencil, Plus, Search, X } from 'lucide-react';
import { api } from './api';
import { saveProjectAndReload } from './project-save';
import { projectCodeForSubmission } from './project-code';
import { ProjectCodeInput } from './project-code-input';

export type Client = {
  id: string; legalName: string; tradeName: string | null; documentType: string; documentNumber: string;
  contactName: string | null; email: string | null; phone: string | null; address: string | null;
  city: string | null; notes: string | null; status: 'active' | 'inactive'; establishmentCount: number; projectCount: number;
};
export type Establishment = {
  id: string; clientId: string; clientName: string; code: string | null; name: string; address: string; city: string;
  department: string | null; country: string; latitude: number | null; longitude: number | null;
  contactName: string | null; email: string | null; phone: string | null; status: 'active' | 'inactive'; projectCount: number;
};
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type Project = {
  id: string; clientId: string; clientName: string; establishmentId: string; establishmentName: string;
  code: string; name: string; description: string | null; status: ProjectStatus;
  startsOn: string | null; dueOn: string | null; createdAt: string; updatedAt: string;
};

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const optional = (data: FormData, name: string) => text(data, name) || null;
const optionalNumber = (data: FormData, name: string) => {
  const value = text(data, name); return value === '' ? null : Number(value);
};
const documentLabels: Record<string, string> = { nit: 'NIT', cc: 'Cédula', ce: 'Cédula de extranjería', passport: 'Pasaporte', other: 'Otro' };
const projectLabels: Record<ProjectStatus, string> = { draft: 'Borrador', active: 'Activo', on_hold: 'En pausa', completed: 'Completado', cancelled: 'Cancelado' };

function Empty({ icon: Icon, title, description }: { icon: typeof Building2; title: string; description: string }) {
  return <div className="empty"><Icon size={32} /><h3>{title}</h3><p>{description}</p></div>;
}

export function ClientsPage() {
  const [items, setItems] = useState<Client[]>([]); const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Client | null | undefined>(undefined); const [message, setMessage] = useState('');
  const load = () => api<{ clients: Client[] }>('/clients').then((response) => setItems(response.clients));
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const filtered = useMemo(() => items.filter((item) => `${item.legalName} ${item.tradeName ?? ''} ${item.documentNumber}`.toLowerCase().includes(search.toLowerCase())), [items, search]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const payload = {
      legalName: text(data, 'legalName'), tradeName: optional(data, 'tradeName'), documentType: text(data, 'documentType'),
      documentNumber: text(data, 'documentNumber'), contactName: optional(data, 'contactName'), email: optional(data, 'email'),
      phone: optional(data, 'phone'), address: optional(data, 'address'), city: optional(data, 'city'), notes: optional(data, 'notes')
    };
    try {
      await api(selected ? `/clients/${selected.id}` : '/clients', { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setSelected(undefined); setMessage(selected ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar el cliente.'); }
  }
  async function toggle(item: Client) {
    try { await api(`/clients/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'active' ? 'inactive' : 'active' }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cambiar el estado.'); }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">Gestión comercial</p><h2>Clientes</h2><p>Organizaciones y personas atendidas por JR.</p></div><button className="primary" onClick={() => setSelected(null)}><Plus size={18} /> Nuevo cliente</button></header>
    {message && <div className="alert info">{message}</div>}
    <section className="panel table-panel"><div className="toolbar"><label className="search"><Search size={18} /><input aria-label="Buscar clientes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o identificación" /></label><span>{filtered.length} clientes</span></div>
      {filtered.length === 0 ? <Empty icon={Building2} title="Aún no hay clientes" description="Crea el primer cliente para asociar establecimientos y proyectos." /> : <div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Identificación</th><th>Contacto</th><th>Establecimientos</th><th>Proyectos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="person"><span>{item.legalName.charAt(0)}</span><div><strong>{item.legalName}</strong><small>{item.tradeName || item.city || 'Sin nombre comercial'}</small></div></div></td><td>{documentLabels[item.documentType]}<br /><small>{item.documentNumber}</small></td><td>{item.contactName || 'Sin contacto'}<br /><small>{item.email || item.phone || '—'}</small></td><td>{item.establishmentCount}</td><td>{item.projectCount}</td><td><span className={`badge ${item.status}`}>{item.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions"><button className="text-button" onClick={() => setSelected(item)}><Pencil size={14} /> Editar</button><button className="text-button" onClick={() => toggle(item)}>{item.status === 'active' ? 'Inactivar' : 'Activar'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {selected !== undefined && <div className="modal-backdrop"><section className="modal wide-modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setSelected(undefined)} aria-label="Cerrar"><X /></button><p className="eyebrow">Etapa 2</p><h3>{selected ? 'Editar cliente' : 'Nuevo cliente'}</h3><form className="entity-form" onSubmit={save}>
      <label>Razón social<input name="legalName" defaultValue={selected?.legalName} required minLength={2} /></label><label>Nombre comercial<input name="tradeName" defaultValue={selected?.tradeName ?? ''} /></label>
      <label>Tipo de identificación<select name="documentType" defaultValue={selected?.documentType ?? 'nit'}><option value="nit">NIT</option><option value="cc">Cédula</option><option value="ce">Cédula de extranjería</option><option value="passport">Pasaporte</option><option value="other">Otro</option></select></label><label>Número<input name="documentNumber" defaultValue={selected?.documentNumber} required pattern="[A-Za-z0-9.-]{3,40}" /></label>
      <label>Persona de contacto<input name="contactName" defaultValue={selected?.contactName ?? ''} /></label><label>Correo<input name="email" type="email" defaultValue={selected?.email ?? ''} /></label>
      <label>Teléfono<input name="phone" defaultValue={selected?.phone ?? ''} /></label><label>Ciudad<input name="city" defaultValue={selected?.city ?? ''} /></label>
      <label className="full">Dirección<input name="address" defaultValue={selected?.address ?? ''} /></label><label className="full">Notas<textarea name="notes" defaultValue={selected?.notes ?? ''} maxLength={1000} /></label>
      <div className="modal-actions full"><button type="button" className="secondary" onClick={() => setSelected(undefined)}>Cancelar</button><button className="primary">Guardar cliente</button></div>
    </form></section></div>}
  </>;
}

export function EstablishmentsPage() {
  const [items, setItems] = useState<Establishment[]>([]); const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState(''); const [clientFilter, setClientFilter] = useState('');
  const [selected, setSelected] = useState<Establishment | null | undefined>(undefined); const [message, setMessage] = useState('');
  const load = () => Promise.all([api<{ establishments: Establishment[] }>('/establishments'), api<{ clients: Client[] }>('/clients')]).then(([e, c]) => { setItems(e.establishments); setClients(c.clients); });
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const filtered = useMemo(() => items.filter((item) => (!clientFilter || item.clientId === clientFilter) && `${item.name} ${item.code ?? ''} ${item.city}`.toLowerCase().includes(search.toLowerCase())), [items, search, clientFilter]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const common = { code: optional(data, 'code'), name: text(data, 'name'), address: text(data, 'address'), city: text(data, 'city'), department: optional(data, 'department'), country: text(data, 'country'), latitude: optionalNumber(data, 'latitude'), longitude: optionalNumber(data, 'longitude'), contactName: optional(data, 'contactName'), email: optional(data, 'email'), phone: optional(data, 'phone') };
    const payload = selected ? common : { clientId: text(data, 'clientId'), ...common };
    try { await api(selected ? `/establishments/${selected.id}` : '/establishments', { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) }); setSelected(undefined); setMessage(selected ? 'Establecimiento actualizado.' : 'Establecimiento creado.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar el establecimiento.'); }
  }
  async function toggle(item: Establishment) {
    try { await api(`/establishments/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'active' ? 'inactive' : 'active' }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cambiar el estado.'); }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">Ubicaciones del cliente</p><h2>Establecimientos</h2><p>Sedes físicas donde JR ejecutará proyectos.</p></div><button className="primary" disabled={!clients.some((c) => c.status === 'active')} onClick={() => setSelected(null)}><Plus size={18} /> Nuevo establecimiento</button></header>
    {message && <div className="alert info">{message}</div>}
    <section className="panel table-panel"><div className="toolbar filters"><label className="search"><Search size={18} /><input aria-label="Buscar establecimientos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, código o ciudad" /></label><select aria-label="Filtrar por cliente" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="">Todos los clientes</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.legalName}</option>)}</select><span>{filtered.length} establecimientos</span></div>
      {filtered.length === 0 ? <Empty icon={MapPin} title="Aún no hay establecimientos" description="Primero crea un cliente activo y luego registra sus ubicaciones." /> : <div className="table-scroll"><table><thead><tr><th>Establecimiento</th><th>Cliente</th><th>Ubicación</th><th>Contacto</th><th>Proyectos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.code || 'Sin código'}</small></td><td>{item.clientName}</td><td>{item.address}<br /><small>{item.city}{item.department ? `, ${item.department}` : ''}</small></td><td>{item.contactName || 'Sin contacto'}<br /><small>{item.email || item.phone || '—'}</small></td><td>{item.projectCount}</td><td><span className={`badge ${item.status}`}>{item.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions"><button className="text-button" onClick={() => setSelected(item)}><Pencil size={14} /> Editar</button><button className="text-button" onClick={() => toggle(item)}>{item.status === 'active' ? 'Inactivar' : 'Activar'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {selected !== undefined && <div className="modal-backdrop"><section className="modal wide-modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setSelected(undefined)} aria-label="Cerrar"><X /></button><p className="eyebrow">Etapa 2</p><h3>{selected ? 'Editar establecimiento' : 'Nuevo establecimiento'}</h3><form className="entity-form" onSubmit={save}>
      {selected ? <label className="full">Cliente<input value={selected.clientName} disabled /></label> : <label className="full">Cliente<select name="clientId" required defaultValue=""><option value="" disabled>Seleccionar cliente</option>{clients.filter((client) => client.status === 'active').map((client) => <option value={client.id} key={client.id}>{client.legalName}</option>)}</select></label>}
      <label>Nombre<input name="name" defaultValue={selected?.name} required /></label><label>Código interno<input name="code" defaultValue={selected?.code ?? ''} /></label>
      <label className="full">Dirección<input name="address" defaultValue={selected?.address} required /></label><label>Ciudad<input name="city" defaultValue={selected?.city} required /></label><label>Departamento<input name="department" defaultValue={selected?.department ?? ''} /></label>
      <label>País<input name="country" defaultValue={selected?.country ?? 'Colombia'} required /></label><label>Contacto<input name="contactName" defaultValue={selected?.contactName ?? ''} /></label>
      <label>Correo<input name="email" type="email" defaultValue={selected?.email ?? ''} /></label><label>Teléfono<input name="phone" defaultValue={selected?.phone ?? ''} /></label>
      <label>Latitud opcional<input name="latitude" type="number" step="any" min="-90" max="90" defaultValue={selected?.latitude ?? ''} /></label><label>Longitud opcional<input name="longitude" type="number" step="any" min="-180" max="180" defaultValue={selected?.longitude ?? ''} /></label>
      <div className="modal-actions full"><button type="button" className="secondary" onClick={() => setSelected(undefined)}>Cancelar</button><button className="primary">Guardar establecimiento</button></div>
    </form></section></div>}
  </>;
}

export function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]); const [clients, setClients] = useState<Client[]>([]); const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [selected, setSelected] = useState<Project | null | undefined>(undefined);
  const [formCode, setFormCode] = useState('');
  const [formClientId, setFormClientId] = useState(''); const [formEstablishmentId, setFormEstablishmentId] = useState(''); const [message, setMessage] = useState('');
  const load = () => Promise.all([api<{ projects: Project[] }>('/projects'), api<{ clients: Client[] }>('/clients'), api<{ establishments: Establishment[] }>('/establishments')]).then(([p, c, e]) => { setItems(p.projects); setClients(c.clients); setEstablishments(e.establishments); });
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const filtered = useMemo(() => items.filter((item) => (!statusFilter || item.status === statusFilter) && `${item.code} ${item.name} ${item.clientName}`.toLowerCase().includes(search.toLowerCase())), [items, search, statusFilter]);
  const availableEstablishments = establishments.filter((item) => item.clientId === formClientId && (item.status === 'active' || item.id === selected?.establishmentId));
  function openProject(item: Project | null) {
    const clientId = item?.clientId ?? clients.find((client) => client.status === 'active')?.id ?? '';
    const establishmentId = item?.establishmentId ?? establishments.find((establishment) => establishment.clientId === clientId && establishment.status === 'active')?.id ?? '';
    setSelected(item); setFormCode(item?.code ?? ''); setFormClientId(clientId); setFormEstablishmentId(establishmentId);
  }
  function changeClient(clientId: string) {
    setFormClientId(clientId); setFormEstablishmentId(establishments.find((item) => item.clientId === clientId && item.status === 'active')?.id ?? '');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    let code: string;
    try { code = projectCodeForSubmission(formCode); }
    catch (error) { setMessage((error as Error).message); return; }
    const payload = { clientId: formClientId, establishmentId: formEstablishmentId, code, name: text(data, 'name'), description: optional(data, 'description'), startsOn: optional(data, 'startsOn'), dueOn: optional(data, 'dueOn') };
    const result = await saveProjectAndReload(
      () => api(selected ? `/projects/${selected.id}` : '/projects', { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) }), load
    );
    if (!result.saved) {
      setMessage(result.error instanceof Error ? result.error.message : 'No fue posible guardar el proyecto.');
      return;
    }
    setSelected(undefined);
    const success = selected ? 'Proyecto actualizado.' : 'Proyecto creado.';
    setMessage(result.reloadError
      ? `${success} No se pudo actualizar la lista. ${result.reloadError instanceof Error ? result.reloadError.message : 'Vuelve a cargar la página para verlo.'}`
      : success);
  }
  async function changeStatus(item: Project, status: ProjectStatus) {
    try { await api(`/projects/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cambiar el estado.'); }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">Ejecución de servicios</p><h2>Proyectos</h2><p>Trabajos asociados a un cliente y un establecimiento.</p></div><button className="primary" disabled={!establishments.some((e) => e.status === 'active')} onClick={() => openProject(null)}><Plus size={18} /> Nuevo proyecto</button></header>
    {message && <div className="alert info">{message}</div>}
    <section className="panel table-panel"><div className="toolbar filters"><label className="search"><Search size={18} /><input aria-label="Buscar proyectos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, proyecto o cliente" /></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{Object.entries(projectLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><span>{filtered.length} proyectos</span></div>
      {filtered.length === 0 ? <Empty icon={BriefcaseBusiness} title="Aún no hay proyectos" description="Registra un establecimiento activo para crear el primer proyecto." /> : <div className="table-scroll"><table><thead><tr><th>Proyecto</th><th>Cliente</th><th>Establecimiento</th><th>Fechas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.code}</small></td><td>{item.clientName}</td><td>{item.establishmentName}</td><td>{item.startsOn || 'Sin inicio'}<br /><small>{item.dueOn ? `Hasta ${item.dueOn}` : 'Sin fecha límite'}</small></td><td><select className={`status-select ${item.status}`} value={item.status} onChange={(event) => changeStatus(item, event.target.value as ProjectStatus)}>{Object.entries(projectLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td><td><button className="text-button" onClick={() => openProject(item)}><Pencil size={14} /> Editar</button></td></tr>)}</tbody></table></div>}
    </section>
    {selected !== undefined && <div className="modal-backdrop"><section className="modal wide-modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setSelected(undefined)} aria-label="Cerrar"><X /></button><p className="eyebrow">Etapa 2</p><h3>{selected ? 'Editar proyecto' : 'Nuevo proyecto'}</h3><form className="entity-form" onSubmit={save}>
      <label>Cliente<select value={formClientId} onChange={(event) => changeClient(event.target.value)} required><option value="" disabled>Seleccionar cliente</option>{clients.filter((client) => client.status === 'active' || client.id === selected?.clientId).map((client) => <option value={client.id} key={client.id}>{client.legalName}</option>)}</select></label>
      <label>Establecimiento<select value={formEstablishmentId} onChange={(event) => setFormEstablishmentId(event.target.value)} required><option value="" disabled>Seleccionar establecimiento</option>{availableEstablishments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Código<ProjectCodeInput value={formCode} onChange={setFormCode} /></label><label>Nombre<input name="name" defaultValue={selected?.name} required /></label>
      <label>Fecha de inicio<input name="startsOn" type="date" defaultValue={selected?.startsOn ?? ''} /></label><label>Fecha límite<input name="dueOn" type="date" defaultValue={selected?.dueOn ?? ''} /></label>
      <label className="full">Descripción<textarea name="description" defaultValue={selected?.description ?? ''} maxLength={1000} /></label>
      <div className="modal-actions full"><button type="button" className="secondary" onClick={() => setSelected(undefined)}>Cancelar</button><button className="primary" disabled={!formClientId || !formEstablishmentId}>Guardar proyecto</button></div>
    </form></section></div>}
  </>;
}
