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

const riskOptions = [
  { value: "conservative", label: "保守型" },
  { value: "moderate", label: "稳健型" },
  { value: "balanced", label: "平衡型" },
  { value: "aggressive", label: "进取型" },
];

const featureLabels: Record<string, string> = {
  client_360: "客户 360 画像",
  nba_suggestions: "下一步行动建议",
  task_drafts: "任务草稿",
  auto_outreach: "自动触达",
  direct_contact_storage: "直接联系方式存储",
  org_rbac_import: "机构权限导入",
};

const assetLabels: Record<string, string> = {
  equity: "权益类",
  bond: "固收类",
  stock: "股票",
  hybrid: "混合类",
  unknown: "未知资产",
};

const contactFieldLabels: Record<string, string> = {
  phone: "手机号",
  mobile: "手机号",
  email: "邮箱",
  wechat: "微信",
  weixin: "微信",
  address: "地址",
  id_card: "证件号",
  identity_no: "证件号",
  contact: "联系方式",
};

export default function CMWorkbench() {
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
  const [clientRef, setClientRef] = useState("demo_client_001");
  const [displayName, setDisplayName] = useState("演示客户");
  const [riskLevel, setRiskLevel] = useState("moderate");
  const [age, setAge] = useState(42);
  const [goalText, setGoalText] = useState("养老，子女教育");
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
    () => goalText.split(/[，,]/).map(item => item.trim()).filter(Boolean),
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
      setError(err?.message || "工作台请求失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 pb-16 pt-20 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs tracking-[0.18em] text-cyan-200/70">机构营销工作台</p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">客户经理工作台</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
              面向券商营销场景，生成客户 360 画像、人工复核的下一步行动建议和任务草稿。
            </p>
          </div>
          <button
            type="button"
            onClick={runWorkspace}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 className="h-4 w-4" />
            {loading ? "生成中" : "生成工作建议"}
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
              客户输入
            </div>
            <div className="mt-4 space-y-4">
              <TextField label="客户编号" value={clientRef} onChange={setClientRef} />
              <TextField label="客户名称" value={displayName} onChange={setDisplayName} />
              <div>
                <div className="mb-2 text-xs text-white/50">风险等级</div>
                <div className="grid grid-cols-2 gap-2">
                  {riskOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRiskLevel(option.value)}
                      className={`h-9 rounded-md border px-2 text-xs transition ${
                        riskLevel === option.value
                          ? "border-cyan-300 bg-cyan-300/20 text-cyan-100"
                          : "border-white/10 bg-white/5 text-white/65 hover:border-white/25"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <NumberField label="年龄" value={age} min={18} max={85} step={1} onChange={setAge} />
              <TextField label="投资目标" value={goalText} onChange={setGoalText} />
              <NumberField label="权益类权重" value={equityWeight} min={0} max={1} step={0.05} onChange={setEquityWeight} />
              <NumberField label="固收类权重" value={bondWeight} min={0} max={1} step={0.05} onChange={setBondWeight} />
            </div>
          </section>

          <section className="space-y-5">
            <div className="grid gap-5 md:grid-cols-3">
              <StatusPanel title="客户 360" value={formatStatus(profile?.data_quality.status)} icon={<ShieldCheck className="h-4 w-4" />} />
              <StatusPanel title="行动建议" value={suggestions.length ? `${suggestions.length} 条草稿` : "待生成"} icon={<Sparkles className="h-4 w-4" />} />
              <StatusPanel title="任务草稿" value={tasks.length ? `${tasks.length} 条草稿` : "待生成"} icon={<ClipboardList className="h-4 w-4" />} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title="客户画像">
                {profile ? (
                  <div className="space-y-3 text-sm">
                    <KV label="客户" value={`${profile.display_name}（${profile.client_ref}）`} />
                    <KV label="风险等级" value={formatRisk(profile.risk_level)} />
                    <KV label="生命周期阶段" value={formatLifeStage(profile.life_stage)} />
                    <KV label="当前持仓" value={formatHoldings(profile.holding_assets)} />
                    <KV label="数据质量" value={`${formatStatus(profile.data_quality.status)}，覆盖度 ${profile.data_quality.coverage}`} />
                    <KV label="已剔除联系方式" value={formatContactFields(profile.contact_policy.removed_fields)} />
                  </div>
                ) : (
                  <EmptyState text="生成客户画像后，可查看适当性、持仓和证据缺口。" />
                )}
              </Panel>

              <Panel title="合规开关">
                <div className="grid gap-2 text-sm">
                  {features ? Object.entries(features.features).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-white/70">{featureLabels[key] || key}</span>
                      <span className={value ? "text-cyan-200" : "text-amber-200"}>{formatBoolean(value)}</span>
                    </div>
                  )) : <EmptyState text="正在加载功能开关。" />}
                </div>
              </Panel>
            </div>

            <Panel title="下一步行动建议">
              {suggestions.length ? (
                <div className="grid gap-3">
                  {suggestions.map(item => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{item.title}</div>
                        <span className="rounded bg-white/10 px-2 py-1 text-xs text-white/70">{formatPriority(item.priority)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/60">{item.rationale}</p>
                      <div className="mt-3 text-xs text-white/45">
                        仅人工复核：{formatBoolean(item.manual_only)} | 自动发送：{formatBoolean(item.auto_send)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="暂无行动建议，请先生成工作建议。" />
              )}
            </Panel>

            <Panel title="任务草稿">
              {tasks.length ? (
                <div className="grid gap-3">
                  {tasks.map(task => (
                    <div key={task.id} className="rounded-md border border-white/10 bg-white/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-medium">{task.title}</div>
                        <span className="text-xs text-white/45">截止日期 {task.due_date}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/60">{task.note}</p>
                      <div className="mt-3 text-xs text-white/45">
                        状态：{formatTaskStatus(task.status)} | 需人工确认：{formatBoolean(task.requires_manual_approval)} | 自动发送：{formatBoolean(task.auto_send)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="生成行动建议后，这里会展示待人工确认的任务草稿。" />
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
      <div className="flex items-center gap-2 text-xs tracking-[0.12em] text-white/45">
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

function formatBoolean(value: boolean) {
  return value ? "是" : "否";
}

function formatStatus(status?: string) {
  if (!status) return "待生成";
  const labels: Record<string, string> = {
    real: "真实可用",
    partial: "部分可用",
    missing: "缺失",
    draft: "草稿",
    idle: "待生成",
  };
  return labels[status] || status;
}

function formatTaskStatus(status: string) {
  return status === "draft" ? "草稿" : status;
}

function formatPriority(priority: string) {
  const labels: Record<string, string> = {
    high: "高优先级",
    medium: "中优先级",
    low: "低优先级",
  };
  return labels[priority] || priority;
}

function formatRisk(risk: string) {
  const match = riskOptions.find(item => item.value === risk);
  return match?.label || risk;
}

function formatLifeStage(stage: string) {
  const labels: Record<string, string> = {
    accumulation: "财富积累期",
    family_growth: "家庭成长期",
    pre_retirement: "退休准备期",
    unknown: "未知",
  };
  return labels[stage] || stage;
}

function formatHoldings(holdings: Record<string, number>) {
  const entries = Object.entries(holdings);
  if (!entries.length) return "缺失";
  return entries.map(([asset, value]) => `${assetLabels[asset] || asset}: ${value}`).join("，");
}

function formatContactFields(fields: string[]) {
  if (!fields.length) return "无";
  return fields.map(field => contactFieldLabels[field] || field).join("，");
}
