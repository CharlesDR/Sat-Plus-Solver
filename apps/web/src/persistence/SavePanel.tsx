/**
 * Saves and sharing for the whole world (PLAN M9): named local slots, file
 * export and import, and share links. Loading anything keeps the world it
 * replaces as the backup, which "Restore previous world" brings back.
 */
import { parseWorld, serializeWorld, type ModelerReportLine, type World } from '@sps/world';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Field } from '../controls/Field';
import type { WorldStore } from '../store';
import type { Saves, SlotInfo } from './saves';
import type { Boot } from './session';
import { isShareHash, readShareHash } from './share';
import { downloadText, modelerFileName, ShareControls } from './ShareControls';
import { ChevronDownIcon, FileIcon } from '../ui/icons';
import { useToast } from '../ui/toasts';

type Notice = { kind: 'info' | 'error'; text: string; restorable?: boolean };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The notice the app opens with, from where its world came from. */
function bootNotice(boot: Boot, saves: Saves): Notice | undefined {
  if (boot.source === 'link')
    return {
      kind: 'info',
      text: 'Opened a shared world.',
      restorable: saves.readBackup() !== undefined,
    };
  if (boot.problem) return { kind: 'error', text: boot.problem };
  return undefined;
}

/** Drops a share link from the address bar once it is loaded, so a reload keeps later edits. */
function clearShareHash() {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    window.location.hash = '';
  }
}

/** Satisfactory Modeler files (M14): both run in the solver worker. */
export interface ModelerFiles {
  /** The world with the save imported, and what was made; `null` if a newer solve replaced it. */
  importText(text: string): Promise<{
    world: World;
    factories: string[];
    report: ModelerReportLine[];
    inferred: number;
  } | null>;
  /** The whole world as a `.sfmd` file's text; `null` if a newer solve replaced it. */
  exportWorld(): Promise<string | null>;
}

/** One report line as the File menu lists it. */
export function reportText(l: ModelerReportLine): string {
  const where = [l.factory, l.node].filter(Boolean).join(': ');
  return where ? `${where} ${l.message}` : l.message;
}

export function SavePanel(props: {
  store: WorldStore;
  saves: Saves;
  boot: Boot;
  modeler?: ModelerFiles;
  /** Opens the New world dialog (N1). */
  onNewWorld(): void;
}) {
  const { store, saves, boot, modeler, onNewWorld } = props;
  const [report, setReport] = useState<ModelerReportLine[]>();
  const [busy, setBusy] = useState<string>();
  const world = useStore(store, (s) => s.world);
  const [slots, setSlots] = useState<SlotInfo[]>(() => saves.list());
  const [name, setName] = useState(world.meta.name ?? '');
  const [worldName, setWorldName] = useState(world.meta.name ?? '');
  // A load or a new world brings its own name.
  const [seenName, setSeenName] = useState(world.meta.name);
  if (seenName !== world.meta.name) {
    setSeenName(world.meta.name);
    setWorldName(world.meta.name ?? '');
    setName(world.meta.name ?? '');
  }
  const [notice, setNotice] = useState<Notice | undefined>(() => bootNotice(boot, saves));
  const menu = useRef<HTMLDetailsElement>(null);
  const toast = useToast();

  // The opening notice also pops up, since the menu starts closed.
  useEffect(() => {
    const first = bootNotice(boot, saves);
    if (first?.kind === 'info') toast(first.text);
  }, [boot, saves, toast]);

  // The menu closes on Escape and on a click outside it.
  useEffect(() => {
    const close = () => menu.current?.removeAttribute('open');
    const onClick = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu.current?.open) {
        // Handled: Esc closes the menu and goes no further (A42).
        e.preventDefault();
        close();
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /** Loads a world, keeping the current one as the backup. */
  const load = useCallback(
    (next: World, text: string) => {
      saves.backupAutosave();
      store.getState().loadWorld(next);
      setNotice({ kind: 'info', text, restorable: saves.available });
    },
    [saves, store],
  );
  const failed = (what: string, e: unknown) =>
    setNotice({ kind: 'error', text: `${what}: ${why(e)}` });

  // A share link pasted into this tab changes only the fragment.
  useEffect(() => {
    const onHash = () => {
      if (!isShareHash(window.location.hash)) return;
      try {
        load(readShareHash(window.location.hash), 'Opened a shared world.');
      } catch (e) {
        failed('The share link could not be opened', e);
      }
      clearShareHash();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  const save = () => {
    const out = saves.save(name, serializeWorld(world));
    if (!out.ok) return setNotice({ kind: 'error', text: out.message });
    setSlots(saves.list());
    setNotice({ kind: 'info', text: `Saved “${out.slot.name}”.` });
  };
  const loadSlot = (slot: SlotInfo) => {
    const text = saves.load(slot.id);
    if (text === undefined)
      return setNotice({ kind: 'error', text: `The save “${slot.name}” is missing.` });
    try {
      load(parseWorld(text), `Loaded “${slot.name}”.`);
    } catch (e) {
      failed(`The save “${slot.name}” could not be read`, e);
    }
  };
  const removeSlot = (slot: SlotInfo) => {
    saves.remove(slot.id);
    setSlots(saves.list());
    setNotice({ kind: 'info', text: `Deleted “${slot.name}”.` });
  };
  const importFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then(
      (text) => {
        try {
          load(parseWorld(text), `Imported “${file.name}”.`);
        } catch (e) {
          failed(`“${file.name}” could not be imported`, e);
        }
      },
      (e: unknown) => failed(`“${file.name}” could not be read`, e),
    );
  };
  const importModeler = (file: File | undefined) => {
    if (!file || !modeler) return;
    setBusy(`Importing “${file.name}”…`);
    file
      .text()
      .then((text) => modeler.importText(text))
      .then(
        (out) => {
          if (!out)
            return failed(`“${file.name}” could not be imported`, 'the solver was busy; try again');
          const n = out.factories.length;
          load(
            out.world,
            `Imported ${n} ${n === 1 ? 'factory' : 'factories'} from “${file.name}”, in manual mode and marked as built.` +
              (out.inferred > 0
                ? ` ${out.inferred} machine counts were sized from the save's flows.`
                : ''),
          );
          setReport(out.report);
        },
        (e: unknown) => failed(`“${file.name}” could not be imported`, e),
      )
      .finally(() => setBusy(undefined));
  };
  const exportModeler = () => {
    if (!modeler) return;
    setBusy('Exporting to Modeler…');
    modeler
      .exportWorld()
      .then(
        (text) => {
          if (text === null)
            return failed('The export did not finish', 'the solver was busy; try again');
          downloadText(modelerFileName('world'), text);
        },
        (e: unknown) => failed('The Modeler export failed', e),
      )
      .finally(() => setBusy(undefined));
  };
  const restore = () => {
    const text = saves.readBackup();
    if (text === undefined) return;
    try {
      load(parseWorld(text), 'Restored the previous world.');
    } catch (e) {
      failed('The previous world could not be read', e);
    }
  };

  return (
    <details
      className="saves controls menu"
      ref={menu}
      // A save made elsewhere (New world's "save first") shows when the menu opens.
      onToggle={() => {
        if (menu.current?.open) setSlots(saves.list());
      }}
    >
      <summary title="Save, load, export and share">
        <FileIcon />
        <span>File</span>
        <ChevronDownIcon />
      </summary>
      <div className="menu-panel">
        <h2 className="menu-title">Save and share</h2>
        <div className="row toolbar">
          <button
            type="button"
            onClick={() => {
              menu.current?.removeAttribute('open');
              onNewWorld();
            }}
          >
            New world…
          </button>
          <Field label="World name">
            {(id) => (
              <input
                id={id}
                value={worldName}
                placeholder="Unnamed"
                onChange={(e) => setWorldName(e.target.value)}
                onBlur={() => store.getState().renameWorld(worldName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') store.getState().renameWorld(worldName);
                }}
              />
            )}
          </Field>
        </div>
        {notice && (
          <p className={notice.kind === 'error' ? 'error' : 'notice'} role="status">
            {notice.text}{' '}
            {notice.restorable && (
              <button type="button" onClick={restore}>
                Restore previous world
              </button>
            )}
          </p>
        )}
        <fieldset>
          <legend>Local saves</legend>
          {saves.available ? (
            <>
              <form
                className="row toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <Field label="Save name">
                  {(id) => (
                    <input
                      id={id}
                      value={name}
                      list="save-names"
                      onChange={(e) => setName(e.target.value)}
                    />
                  )}
                </Field>
                <datalist id="save-names">
                  {slots.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
                <button type="submit">Save</button>
              </form>
              {slots.length ? (
                <table aria-label="Saves">
                  <tbody>
                    {slots.map((s) => (
                      <tr key={s.id} data-slot={s.id}>
                        <td>{s.name}</td>
                        <td>{new Date(s.savedAt).toLocaleString()}</td>
                        <td>
                          <button type="button" onClick={() => loadSlot(s)}>
                            Load {s.name}
                          </button>{' '}
                          <button type="button" onClick={() => removeSlot(s)}>
                            Delete {s.name}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No saves yet. The world is also autosaved as you edit.</p>
              )}
            </>
          ) : (
            <p className="warning">
              This browser does not allow local saves, so nothing is autosaved. Export the world as
              a file to keep it.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>File and link</legend>
          <ShareControls world={() => store.getState().world} name="world" what="world" />
          <Field label="Import world file">
            {(id) => (
              <input
                id={id}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  importFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            )}
          </Field>
        </fieldset>
        {modeler && (
          <fieldset>
            <legend>Satisfactory Modeler</legend>
            <p className="hint">
              A Modeler save imports as factories in manual mode, marked as built. The export opens
              in Modeler with its calculator set to Manual.
            </p>
            <div className="row">
              <button type="button" onClick={exportModeler} disabled={busy !== undefined}>
                Export world to Modeler
              </button>
            </div>
            <Field label="Import Modeler file (.sfmd)">
              {(id) => (
                <input
                  id={id}
                  type="file"
                  accept=".sfmd"
                  disabled={busy !== undefined}
                  onChange={(e) => {
                    importModeler(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              )}
            </Field>
            {busy && (
              <p role="status" aria-busy="true">
                {busy}
              </p>
            )}
            {report && report.length > 0 && (
              <details className="modeler-report" open>
                <summary>Import report ({report.length})</summary>
                <ul aria-label="Modeler import report">
                  {report.map((l, k) => (
                    <li key={k}>{reportText(l)}</li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>
        )}
      </div>
    </details>
  );
}
