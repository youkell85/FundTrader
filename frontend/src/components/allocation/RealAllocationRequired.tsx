import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, FileSearch, Play } from 'lucide-react';

export default function RealAllocationRequired() {
  return (
    <div className="workspace-panel-strong mt-8 p-5 md:p-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            需要真实配置结果
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white md:text-3xl">
            请先生成资产配置方案
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
        结果中心不会再展示占位内容。完成画像采集并调用真实配置引擎后，这里会显示配置报告、基金映射、风险管理、回测和执行计划。
          </p>
        </div>
        <div className="grid w-full gap-2 md:w-[260px]">
          <Link
            to="/allocation"
            className="workspace-action-active flex h-11 items-center justify-center gap-2 text-sm font-medium"
          >
            <Play className="h-4 w-4" />
            生成真实方案
          </Link>
          <Link
            to="/"
            className="workspace-action flex h-10 items-center justify-center gap-2 text-xs"
          >
            <ArrowLeft className="h-4 w-4" />
            返回基金市场
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {[
          ['配置报告', '战略配置、战术调整、约束检查和模型说明只在真实输出后展示。'],
          ['风险与回测', '压力测试、蒙特卡洛、相关性、定投回测均基于实时接口结果。'],
          ['执行计划', '基金权重、定投参数、保存方案和再平衡建议不使用静态样例。'],
        ].map(([title, desc]) => (
          <div key={title} className="workspace-panel p-3">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <FileSearch className="h-4 w-4 text-primary" />
              {title}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-white/45">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
