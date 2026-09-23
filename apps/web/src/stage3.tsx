import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Building, Download, FileUp, Layers3, Pencil, Plus, X } from 'lucide-react';
import { api } from './api';
import type { Project } from './stage2';

type BuildingRow = { id: string; projectId: string; projectName: string; establishmentName: string; code: string | null; name: string; description: string | null; status: 'active' | 'inactive'; floorCount: number };
type FloorRow = { id: string; buildingId: string; buildingName: string; projectId: string; projectName: string; code: string | null; name: string; levelNumber: number; elevationM: number | null; description: string | null; status: 'active' | 'inactive'; planCount: number };
type PlanRow = { id: string; floorId: string; floorName: string; buildingId: string; buildingName: string; projectName: string; title: string; version: number; status: 'pending' | 'ready' | 'superseded' | 'rejected'; fileName: string; contentType: string; sizeBytes: number; createdAt: string };

const value = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const nullable = (data: FormData, name: string) => value(data, name) || null;
const formatSize = (bytes: number) => bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
const planStatus: Record<PlanRow['status'], string> = { pending: 'Pendiente', ready: 'Vigente', superseded: 'Anterior', rejected: 'Rechazado' };

export function Stage3Page() {
  const [projects, setProjects] = useState<Project[]>([]); const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [floors, setFloors] = useState<FloorRow[]>([]); const [plans, setPlans] = useState<PlanRow[]>([]);
  const [projectFilter, setProjectFilter] = useState(''); const [buildingFilter, setBuildingFilter] = useState('');
  const [buildingModal, setBuildingModal] = useState<BuildingRow | null | undefined>(); const [floorModal, setFloorModal] = useState<FloorRow | null | undefined>();
  const [uploadFloor, setUploadFloor] = useState<FloorRow | null>(null); const [guidance, setGuidance] = useState<'building' | 'floor' | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => Promise.all([
    api<{ projects: Project[] }>('/projects'), api<{ buildings: BuildingRow[] }>('/buildings'),
    api<{ floors: FloorRow[] }>('/floors'), api<{ plans: PlanRow[] }>('/floor-plans')
  ]).then(([p, b, f, fp]) => { setProjects(p.projects); setBuildings(b.buildings); setFloors(f.floors); setPlans(fp.plans); });
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const shownBuildings = useMemo(() => buildings.filter((item) => !projectFilter || item.projectId === projectFilter), [buildings, projectFilter]);
  const shownFloors = useMemo(() => floors.filter((item) => (!projectFilter || item.projectId === projectFilter) && (!buildingFilter || item.buildingId === buildingFilter)), [floors, projectFilter, buildingFilter]);
  const shownPlans = useMemo(() => plans.filter((item) => (!projectFilter || floors.find((floor) => floor.id === item.floorId)?.projectId === projectFilter) && (!buildingFilter || item.buildingId === buildingFilter)), [plans, floors, projectFilter, buildingFilter]);
  const availableProjects = projects.filter((project) => !['completed', 'cancelled'].includes(project.status));
  const availableBuildings = buildings.filter((building) => building.status === 'active');
  function openNewBuilding() {
    if (!availableProjects.length) {
      setGuidance('building');
      return;
    }
    setMessage(''); setBuildingModal(null);
  }
  function openNewFloor() {
    if (!availableBuildings.length) {
      setGuidance('floor');
      return;
    }
    setMessage(''); setFloorModal(null);
  }

  async function saveBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const selected = buildingModal;
    const payload = { projectId: value(data, 'projectId'), code: nullable(data, 'code'), name: value(data, 'name'), description: nullable(data, 'description') };
    try { await api(selected ? `/buildings/${selected.id}` : '/buildings', { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) }); setBuildingModal(undefined); setMessage(selected ? 'Edificio actualizado.' : 'Edificio creado.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar el edificio.'); }
  }
  async function saveFloor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const selected = floorModal;
    const common = { code: nullable(data, 'code'), name: value(data, 'name'), levelNumber: Number(value(data, 'levelNumber')), elevationM: value(data, 'elevationM') ? Number(value(data, 'elevationM')) : null, description: nullable(data, 'description') };
    const payload = selected ? common : { buildingId: value(data, 'buildingId'), ...common };
    try { await api(selected ? `/floors/${selected.id}` : '/floors', { method: selected ? 'PUT' : 'POST', body: JSON.stringify(payload) }); setFloorModal(undefined); setMessage(selected ? 'Planta actualizada.' : 'Planta creada.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar la planta.'); }
  }
  async function toggle(kind: 'buildings' | 'floors', item: BuildingRow | FloorRow) {
    const status = item.status === 'active' ? 'inactive' : 'active';
    try { await api(`/${kind}/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cambiar el estado.'); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!uploadFloor) return; const data = new FormData(event.currentTarget); const file = data.get('file');
    if (!(file instanceof File) || !file.size) return setMessage('Selecciona un archivo PDF, PNG o JPG.');
    setBusy(true);
    try {
      const created = await api<{ id: string; uploadUrl: string }> (`/floors/${uploadFloor.id}/plans/presign`, { method: 'POST', body: JSON.stringify({ name: file.name, title: value(data, 'title'), contentType: file.type, sizeBytes: file.size }) });
      const sent = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!sent.ok) throw new Error('El almacenamiento no aceptó el archivo.');
      await api(`/floor-plans/${created.id}/complete`, { method: 'POST' });
      setUploadFloor(null); setMessage('Plano cargado y versionado correctamente.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar el plano.'); }
    finally { setBusy(false); }
  }
  async function download(plan: PlanRow) {
    try { const result = await api<{ downloadUrl: string }>(`/floor-plans/${plan.id}/download`); window.open(result.downloadUrl, '_blank', 'noopener,noreferrer'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible descargar el plano.'); }
  }

  return <>
    <header className="page-heading"><div><p className="eyebrow">Etapa 3</p><h2>Edificios, plantas y planos</h2><p>Estructura física de cada proyecto y repositorio versionado de planos.</p></div><span className="status-pill"><i /> Almacenamiento privado</span></header>
    {message && <div className="alert info">{message}</div>}
    <section className="panel stage3-filters"><label>Proyecto<select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setBuildingFilter(''); }}><option value="">Todos los proyectos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Edificio<select value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="">Todos los edificios</option>{shownBuildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label></section>

    <section className="panel stage3-section"><div className="panel-head"><div><h3><Building size={20} /> Edificios</h3><p>Edificaciones pertenecientes a un proyecto.</p></div><button className="primary" onClick={openNewBuilding}><Plus size={17} /> Nuevo edificio</button></div>
      {shownBuildings.length === 0 ? <div className="empty"><Building size={30} /><h3>Aún no hay edificios</h3><p>Orden requerido: cliente → establecimiento → proyecto → edificio.</p></div> : <div className="table-scroll"><table><thead><tr><th>Edificio</th><th>Proyecto</th><th>Establecimiento</th><th>Plantas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{shownBuildings.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.code || 'Sin código'}</small></td><td>{item.projectName}</td><td>{item.establishmentName}</td><td>{item.floorCount}</td><td><span className={`badge ${item.status}`}>{item.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions"><button className="text-button" onClick={() => setBuildingModal(item)}><Pencil size={14} /> Editar</button><button className="text-button" onClick={() => toggle('buildings', item)}>{item.status === 'active' ? 'Inactivar' : 'Activar'}</button></div></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel stage3-section"><div className="panel-head"><div><h3><Layers3 size={20} /> Plantas</h3><p>Niveles físicos de cada edificio.</p></div><button className="primary" onClick={openNewFloor}><Plus size={17} /> Nueva planta</button></div>
      {shownFloors.length === 0 ? <div className="empty"><Layers3 size={30} /><h3>Aún no hay plantas</h3><p>Registra un edificio activo y añade sus niveles.</p></div> : <div className="table-scroll"><table><thead><tr><th>Planta</th><th>Edificio</th><th>Nivel</th><th>Elevación</th><th>Planos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{shownFloors.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br /><small>{item.code || 'Sin código'}</small></td><td>{item.buildingName}<br /><small>{item.projectName}</small></td><td>{item.levelNumber}</td><td>{item.elevationM == null ? '—' : `${item.elevationM} m`}</td><td>{item.planCount}</td><td><span className={`badge ${item.status}`}>{item.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions"><button className="text-button" onClick={() => setFloorModal(item)}><Pencil size={14} /> Editar</button><button className="text-button" onClick={() => setUploadFloor(item)} disabled={item.status !== 'active'}><FileUp size={14} /> Cargar plano</button><button className="text-button" onClick={() => toggle('floors', item)}>{item.status === 'active' ? 'Inactivar' : 'Activar'}</button></div></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel stage3-section"><div className="panel-head"><div><h3><FileUp size={20} /> Planos cargados</h3><p>Historial de versiones por planta.</p></div><span>{shownPlans.length} archivo{shownPlans.length === 1 ? '' : 's'}</span></div>
      {shownPlans.length === 0 ? <div className="empty"><FileUp size={30} /><h3>Aún no hay planos</h3><p>Usa “Cargar plano” en una planta activa.</p></div> : <div className="table-scroll"><table><thead><tr><th>Plano</th><th>Ubicación</th><th>Versión</th><th>Archivo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{shownPlans.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><br /><small>{item.fileName}</small></td><td>{item.floorName}<br /><small>{item.buildingName} · {item.projectName}</small></td><td>v{item.version}</td><td>{formatSize(item.sizeBytes)}<br /><small>{item.contentType}</small></td><td><span className={`badge ${item.status}`}>{planStatus[item.status]}</span></td><td>{item.status !== 'pending' && item.status !== 'rejected' && <button className="text-button" onClick={() => download(item)}><Download size={14} /> Descargar</button>}</td></tr>)}</tbody></table></div>}
    </section>

    {buildingModal !== undefined && <div className="modal-backdrop"><section className="modal wide-modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setBuildingModal(undefined)} aria-label="Cerrar"><X /></button><p className="eyebrow">Etapa 3</p><h3>{buildingModal ? 'Editar edificio' : 'Nuevo edificio'}</h3><form className="entity-form" onSubmit={saveBuilding}><label className="full">Proyecto<select name="projectId" required defaultValue={buildingModal?.projectId ?? projectFilter}><option value="" disabled>Seleccionar proyecto</option>{projects.filter((project) => !['completed', 'cancelled'].includes(project.status) || project.id === buildingModal?.projectId).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.establishmentName}</option>)}</select></label><label>Nombre<input name="name" required defaultValue={buildingModal?.name} /></label><label>Código<input name="code" defaultValue={buildingModal?.code ?? ''} /></label><label className="full">Descripción<textarea name="description" maxLength={1000} defaultValue={buildingModal?.description ?? ''} /></label><div className="modal-actions full"><button type="button" className="secondary" onClick={() => setBuildingModal(undefined)}>Cancelar</button><button className="primary">Guardar edificio</button></div></form></section></div>}
    {floorModal !== undefined && <div className="modal-backdrop"><section className="modal wide-modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setFloorModal(undefined)} aria-label="Cerrar"><X /></button><p className="eyebrow">Etapa 3</p><h3>{floorModal ? 'Editar planta' : 'Nueva planta'}</h3><form className="entity-form" onSubmit={saveFloor}>{floorModal ? <label className="full">Edificio<input disabled value={floorModal.buildingName} /></label> : <label className="full">Edificio<select name="buildingId" required defaultValue={buildingFilter}><option value="" disabled>Seleccionar edificio</option>{buildings.filter((building) => building.status === 'active').map((building) => <option key={building.id} value={building.id}>{building.name} · {building.projectName}</option>)}</select></label>}<label>Nombre<input name="name" required defaultValue={floorModal?.name} /></label><label>Código<input name="code" defaultValue={floorModal?.code ?? ''} /></label><label>Número de nivel<input name="levelNumber" type="number" min="-20" max="300" required defaultValue={floorModal?.levelNumber ?? 0} /></label><label>Elevación (m)<input name="elevationM" type="number" step="0.01" defaultValue={floorModal?.elevationM ?? ''} /></label><label className="full">Descripción<textarea name="description" maxLength={1000} defaultValue={floorModal?.description ?? ''} /></label><div className="modal-actions full"><button type="button" className="secondary" onClick={() => setFloorModal(undefined)}>Cancelar</button><button className="primary">Guardar planta</button></div></form></section></div>}
    {uploadFloor && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><button className="icon-button close" onClick={() => setUploadFloor(null)} aria-label="Cerrar"><X /></button><p className="eyebrow">Plano de {uploadFloor.name}</p><h3>Cargar nueva versión</h3><form onSubmit={upload}><label>Título del plano<input name="title" required minLength={2} placeholder="Plano arquitectónico" /></label><label>Archivo<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /><small>PDF, PNG o JPG. Máximo según configuración de la plataforma.</small></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setUploadFloor(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Cargando…' : 'Cargar plano'}</button></div></form></section></div>}
    {guidance && <div className="modal-backdrop"><section className="modal prerequisite-modal" role="dialog" aria-modal="true" aria-labelledby="prerequisite-title"><button className="icon-button close" onClick={() => setGuidance(null)} aria-label="Cerrar"><X /></button><p className="eyebrow">Antes de continuar</p><h3 id="prerequisite-title">{guidance === 'building' ? 'Primero debes crear un proyecto' : 'Primero debes crear un edificio'}</h3>{guidance === 'building' ? <><p>Los edificios siempre pertenecen a un proyecto. Registra la información en este orden:</p><ol><li>Cliente</li><li>Establecimiento</li><li>Proyecto</li><li>Edificio</li></ol></> : <p>Las plantas siempre pertenecen a un edificio. Crea o activa un edificio y luego vuelve a esta opción.</p>}<div className="modal-actions"><button type="button" className="primary" onClick={() => setGuidance(null)}>Entendido</button></div></section></div>}
  </>;
}
