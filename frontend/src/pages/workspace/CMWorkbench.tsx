import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ClipboardList, ShieldCheck, Sparkles, UserRound, Wand2 } from "lucide-react";
import {
  getWorkspaceFeatures,
  getClient360,
  getNbaSuggestions,
  getTaskDrafts,
} from "@/lib/api";
import type {
  Client360Profile,
  NbaSuggestion,
  TaskDraft,
  WorkspaceFeatures,
} from "@/types/workspace";

const riskOptions = ["conservative", "moderate", "balanced", "aggressive"];

export default function CMWorkbench() {
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
  const [clientRef, setClientRef] = useState("demo_client_001");
  const [displayName, setDisplayName] = useState("Client Demo");
  const [riskLevel, setRiskLevel] = useState("moderate");
  const [age, setAge] = useState(42);
  const [goalText, setGoalText] = useState("retirement, education");
  const [equityWeight, setEquityWeight] = useState(0.45);
  const [bondWeight, setBondWeight] = useState(0.35);
  const [profile, setProfile] = useState<Client360Profile | null>(null);
  const [suggestions, setSuggestions] = useState<NbaSuggestion[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getWorkspaceFeatures()
      .then(setFeatures)
      .catch((err: Error) => setError(err.message));
  }, []);

  const goals = useMemo(
    () => goalText.split(",").map(item => item.trim()).filter(Boolean),
    [goalText],
  );

  const runWorkspace = async () => {
    setLoading(true);
    setError(null);
    setTasks([]);
    try {
      const payload = {
        client: {
          client_ref: clientRef,
          display_name: displayName,
          risk_level: riskLevel,
          age,
          goals,
        },
        holdings: [
          { asset_class: "equity", weight: equityWeight },
          { asset_class: "bond", weight: bondWeight },
        ],
        context: {
          dca_status: "partial",
          professional_score_status: "partial",
        },
      };
      const client360 = await getClient360(payload);
      setProfile(client360.client_360);
      const nba = await getNbaSuggestions({
        client_360: client360.client_360,
        context: payload.context,
      });
      setSuggestions(nba.suggestions);
      const draftResult = await getTaskDrafts(nba.suggestions);
      setTasks(draftResult.tasks);
    } catch (err: any) {
      setError(err?.message || "Workspace request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 pb-16 pt-20 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Institution Workspace</p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">CM Workbench</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
              Client 360, manual next-best-action suggestions, and task drafts for broker marketing workflows.
            </p>
          </div>
          <button
            type="button"
            onClick={runWorkspace}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 className="h-4 w-4" />
            {loading ? "Running" : "Generate"}
          </button>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]">
          <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UserRound className="h-4 w-4 text-cyan-200" />
              Client inputs
            </div>
            <div className="mt-4 space-y-4">
              <TextField label="Client ref" value={clientRef} onChange={setClientRef} />
              <TextField label="Display name" value={displayName} onChange={setDisplayName} />
              <div>
                <div className="mb-2 text-xs text-white/50">Risk level</div>
                <div className="grid grid-cols-2 gap-2">
                  {riskOptions.map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRiskLevel(option)}
                      className={`h-9 rounded-md border px-2 text-xs capitalize transition ${
                        riskLevel === option
                          ? "border-cyan-300 bg-cyan-300/20 text-cyan-100"
                          : "border-white/10 bg-white/5 text-white/65 hover:border-white/25"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <NumberField label="Age" value={age} min={18} max={85} step={1} onChange={setAge} />
              <TextField label="Goals" value={goalText} onChange={setGoalText} />
              <NumberField label="Equity weight" value={equityWeight} min={0} max={1} step={0.05} onChange={setEquityWeight} />
              <NumberField label="Bond weight" value={bondWeight} min={0} max={1} step={0.05} onChange={setBondWeight} />
            </div>
          </section>

          <section className="space-y-5">
            <div className="grid gap-5 md:grid-cols-3">
              <StatusPanel title="Client 360" value={profile?.data_quality.status || "idle"} icon={<ShieldCheck className="h-4 w-4" />} />
              <StatusPanel title="NBA suggestions" value={suggestions.length ? `${suggestions.length} draft` : "idle"} icon={<Sparkles className="h-4 w-4" />} />
              <StatusPanel title="Task drafts" value={tasks.length ? `${tasks.length} draft` : "idle"} icon={<ClipboardList className="h-4 w-4" />} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title="Profile">
                {profile ? (
                  <div className="space-y-3 text-sm">
                    <KV label="Client" value={`${profile.display_name} (${profile.client_ref})`} />
                    <KV label="Risk" value={profile.risk_level} />
                    <KV label="Life stage" value={profile.life_stage} />
                    <KV label="Holdings" value={Object.entries(profile.holding_assets).map(([k, v]) => `${k}: ${v}`).join(", ") || "missing"} />
                    <KV label="Data quality" value={`${profile.data_quality.status}, coverage ${profile.data_quality.coverage}`} />
                    <KV label="Removed contact fields" value={profile.contact_policy.removed_fields.join(", ") || "none"} />
                  </div>
                ) : (
                  <EmptyState text="Generate a workspace profile to review suitability and evidence gaps." />
                )}
              </Panel>

              <Panel title="Policy flags">
                <div className="grid gap-2 text-sm">
                  {features ? Object.entries(features.features).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-white/70">{key}</span>
                      <span className={value ? "text-cyan-200" : "text-amber-200"}>{String(value)}</span>
                    </div>
                  )) : <EmptyState text="Loading feature flags." />}
                </div>
              </Panel>
            </div>

            <Panel title="Next-best-action suggestions">
              {suggestions.length ? (
                <div className="grid gap-3">
                  {suggestions.map(item => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{item.title}</div>
                        <span className="rounded bg-white/10 px-2 py-1 text-xs uppercase text-white/70">{item.priority}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/60">{item.rationale}</p>
                      <div className="mt-3 text-xs text-white/45">
                        Manual only: {String(item.manual_only)} | Auto send: {String(item.auto_send)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No suggestions generated yet." />
              )}
            </Panel>

            <Panel title="Task drafts">
              {tasks.length ? (
                <div className="grid gap-3">
                  {tasks.map(task => (
                    <div key={task.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-medium">{task.title}</div>
                        <span className="text-xs text-white/45">Due {task.due_date}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/60">{task.note}</p>
                      <div className="mt-3 text-xs text-white/45">
                        Status: {task.status} | Manual approval: {String(task.requires_manual_approval)} | Auto send: {String(task.auto_send)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Task drafts will appear after NBA generation." />
              )}
            </Panel>
          </section>
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-white/50">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-2 h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-300/60"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-white/50">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-2 h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
      />
    </label>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
      <div className="mb-4 text-sm font-semibold text-white/90">{title}</div>
      {children}
    </div>
  );
}

function StatusPanel({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-white/45">
        {icon}
        {title}
      </div>
      <div className="mt-3 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
      <span className="text-white/45">{label}</span>
      <span className="text-right text-white/80">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-white/15 p-4 text-sm text-white/45">{text}</div>;
}
