import React, { createContext, useContext, useReducer } from "react";
import type { ReactNode } from "react";
import type { AllocationRequest, AllocationResponse, VariantsResponse } from "@/types/allocation";
import type { ExecutionPlan, DcaConfig, DcaResult } from "@/lib/execution-plan";

interface S {
  wizardStep: number;
  config: AllocationRequest;
  output: AllocationResponse | null;
  variants: VariantsResponse | null;
  activeTab: string;
  executionPlan: ExecutionPlan | null;
  dcaConfig: DcaConfig | null;
  dcaResult: DcaResult | null;
}

type A =
  | { type: "SET_STEP"; step: number }
  | { type: "UPDATE_CONFIG"; patch: Partial<AllocationRequest> }
  | { type: "SET_OUTPUT"; output: AllocationResponse }
  | { type: "SET_VARIANTS"; variants: VariantsResponse | null }
  | { type: "SET_TAB"; tab: string }
  | { type: "SET_EXECUTION_PLAN"; plan: ExecutionPlan | null }
  | { type: "SET_DCA_CONFIG"; config: DcaConfig | null }
  | { type: "SET_DCA_RESULT"; result: DcaResult | null }
  | { type: "RESET" };

const defaults: AllocationRequest = {
  age: 35,
  goal_type: "wealth",
  investment_horizon: "medium",
  amount: 500000,
  risk_tolerance: "balanced",
  max_drawdown: 24,
  preferred_tags: [],
  behavior_answers: {},
};

const init: S = {
  wizardStep: 1,
  config: { ...defaults },
  output: null,
  variants: null,
  activeTab: "overview",
  executionPlan: null,
  dcaConfig: null,
  dcaResult: null,
};

function reducer(s: S, a: A): S {
  switch (a.type) {
    case "SET_STEP":
      return { ...s, wizardStep: a.step };
    case "UPDATE_CONFIG":
      return { ...s, config: { ...s.config, ...a.patch } };
    case "SET_OUTPUT":
      return { ...s, output: a.output };
    case "SET_VARIANTS":
      return { ...s, variants: a.variants };
    case "SET_TAB":
      return { ...s, activeTab: a.tab };
    case "SET_EXECUTION_PLAN":
      return { ...s, executionPlan: a.plan };
    case "SET_DCA_CONFIG":
      return { ...s, dcaConfig: a.config };
    case "SET_DCA_RESULT":
      return { ...s, dcaResult: a.result };
    case "RESET":
      return { ...init, config: { ...defaults } };
    default:
      return s;
  }
}

const Ctx = createContext<{ state: S; dispatch: React.Dispatch<A> } | null>(null);

export function AllocationProvider({ children }: { children: ReactNode }) {
  const [s, d] = useReducer(reducer, init);
  return React.createElement(Ctx.Provider, { value: { state: s, dispatch: d } }, children);
}

export function useAllocationStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("wrap in AllocationProvider");
  return ctx;
}
