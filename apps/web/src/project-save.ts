// Keep persistence errors separate from list-refresh errors after a saved project.
export async function saveProjectAndReload(save: () => Promise<unknown>, reload: () => Promise<unknown>) {
  try { await save(); }
  catch (error) { return { saved: false as const, error }; }
  try { await reload(); return { saved: true as const }; }
  catch (error) { return { saved: true as const, reloadError: error }; }
}
