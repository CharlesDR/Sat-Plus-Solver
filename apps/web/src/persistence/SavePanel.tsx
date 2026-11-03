/**
 * Saves and sharing for the whole world (PLAN M9): named local slots, file
 * export and import, and share links. Loading anything keeps the world it
 * replaces as the backup, which "Restore previous world" brings back. A link,
 * file or save that is a copy of the open world asks which to keep (A109).
 */
import { parseWorld, serializeWorld, type ModelerReportLine, type World } from '@sps/world';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Field } from '../controls/Field';
import type { WorldStore } from '../store';
import { compareCopies, keepBothName, type CopyCheck } from './copies';
import { CopyDialog } from './CopyDialog';
import type { Saves, SlotInfo } from './saves';
import type { Boot } from './session';
import { isShareHash, readShareHash } from './share';
import { downloadText, modelerFileName, ShareControls } from './ShareControls';
import { ChevronDownIcon, FileIcon } from '../ui/icons';
import { BUILD_STAMP } from '../buildStamp';
import { FileButton } from '../ui/FileButton';
import { useMenuDismiss } from '../ui/Menu';
import { useToast } from '../ui/toasts';

type Notice = { kind: 'info' | 'error'; text: string; restorable?: boolean };

/** A copy of the open world waiting for Replace, Keep both or Cancel (A109). */
interface Pending {
  world: World;
  /** The notice once it is opened. */
  text: string;
  /** What is being opened, for the dialog. */
  what: string;
  check: CopyCheck;
  error?: string;
}

/** Boots whose shared copy has been answered, so a remounted panel does not ask again. */
const answered = new WeakSet<Boot>();

/** The question the app opens with when its link is a copy of the autosaved world. */
function bootPending(boot: Boot, open: World): Pending | undefined {
  if (!boot.incoming || answered.has(boot)) return undefined;
  const check = compareCopies(open, boot.incoming);
  return check
    ? { world: boot.incoming, text: 'Opened a shared world.', what: 'This share link', check }
    : undefined;
}

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
function reportText(l: ModelerReportLine): string {
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
  const [pending, setPending] = useState<Pending | undefined>(() =>
    bootPending(boot, store.getState().world),
  );
  const menu = useRef<HTMLDetailsElement>(null);
  const toast = useToast();

  // The opening notice also pops up, since the menu starts closed.
  useEffect(() => {
    const first = bootNotice(boot, saves);
    if (first?.kind === 'info') toast(first.text);
  }, [boot, saves, toast]);

  // The menu closes on Escape and on a click outside it.
  useMenuDismiss(menu);

  /** Loads a world, keeping the current one as the backup. */
  const load = useCallback(
    (next: World, text: string) => {
      saves.backupAutosave();
      store.getState().loadWorld(next);
      setNotice({ kind: 'info', text, restorable: saves.available });
    },
    [saves, store],
  );
  /** Opens a world, first asking which to keep when it is a copy of the open one (A109). */
  const open = useCallback(
    (next: World, text: string, what: string) => {
      const check = compareCopies(store.getState().world, next);
      if (check) setPending({ world: next, text, what, check });
      else load(next, text);
    },
    [load, store],
  );
  const failed = (what: string, e: unknown) =>
    setNotice({ kind: 'error', text: `${what}: ${why(e)}` });

  // A share link pasted into this tab changes only the fragment.
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      if (!isShareHash(hash)) return;
      clearShareHash();
      readShareHash(hash).then(
        (next) => open(next, 'Opened a shared world.', 'This share link'),
        (e: unknown) => failed('The share link could not be opened', e),
      );
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [open]);

  const settle = () => {
    answered.add(boot);
    setPending(undefined);
  };
  const replace = (p: Pending) => {
    settle();
    load(p.world, p.text);
    toast(p.text);
  };
  const keepBoth = (p: Pending) => {
    const current = store.getState().world;
    const out = saves.save(keepBothName(current), serializeWorld(current));
    if (!out.ok) return setPending({ ...p, error: out.message });
    setSlots(saves.list());
    settle();
    const text = `${p.text} The world you had open is saved as “${out.slot.name}”.`;
    load(p.world, text);
    toast(text);
  };
  const cancel = () => {
    settle();
    setNotice({ kind: 'info', text: 'Kept the world you have open.' });
    toast('Kept the world you have open.');
  };

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
      open(parseWorld(text), `Loaded “${slot.name}”.`, `The save “${slot.name}”`);
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
          open(parseWorld(text), `Imported “${file.name}”.`, `The file “${file.name}”`);
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
      <summary data-help="save-menu">
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
          <div className="row">
            <FileButton
              label="Import world file"
              accept=".json,application/json"
              onFile={importFile}
            />
          </div>
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
            <div className="row">
              <FileButton
                label="Import Modeler file (.sfmd)"
                accept=".sfmd"
                disabled={busy !== undefined}
                onFile={importModeler}
              />
            </div>
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
        <p className="build-stamp" data-testid="build-stamp">
          {BUILD_STAMP}
        </p>
      </div>
      {pending && (
        <CopyDialog
          check={pending.check}
          what={pending.what}
          canKeepBoth={saves.available}
          error={pending.error}
          onReplace={() => replace(pending)}
          onKeepBoth={() => keepBoth(pending)}
          onCancel={cancel}
        />
      )}
    </details>
  );
}
