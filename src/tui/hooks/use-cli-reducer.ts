import { useReducer } from "react";
import type { Phase } from "../cli-constants";
import type { VarDef } from "../config-vars";
import type { ReviewResult } from "../../types";

export interface CliState {
  phase: Phase;
  command: "watch" | "review" | null;
  selectedProfile: string | null;
  configAnswers: Record<string, string>;
  missingVars: VarDef[];
  configIndex: number;
  reviewResult: ReviewResult | null;
  reviewError: string;
  reviewStatus: string;
  prInfo: { prId: number; project: string; repo: string } | null;
  manageProfileName: string | null;
  manageMessage: { text: string; color: string } | null;
  isEditOnly: boolean;
  configOrigin: Phase;
}

export type CliAction =
  | { type: "SET_PHASE"; phase: Phase }
  | { type: "SET_COMMAND"; command: "watch" | "review" }
  | { type: "SELECT_PROFILE"; profile: string }
  | { type: "SET_CONFIG_ANSWERS"; answers: Record<string, string> }
  | { type: "SET_MISSING_VARS"; vars: VarDef[] }
  | { type: "SET_CONFIG_INDEX"; index: number }
  | { type: "CONFIG_BACK"; prevIndex: number; answers: Record<string, string>; vars?: VarDef[] }
  | { type: "SET_REVIEW_STATUS"; status: string }
  | { type: "REVIEW_STARTED"; prInfo: { prId: number; project: string; repo: string } }
  | { type: "REVIEW_COMPLETE"; result: ReviewResult }
  | { type: "REVIEW_ERROR"; error: string }
  | { type: "SET_MANAGE_PROFILE"; name: string | null }
  | { type: "SET_MANAGE_MESSAGE"; message: { text: string; color: string } | null }
  | { type: "SET_EDIT_ONLY"; isEditOnly: boolean }
  | { type: "START_CONFIG"; vars: VarDef[]; answers: Record<string, string>; origin: Phase; isEditOnly?: boolean }
  | { type: "BATCH"; actions: CliAction[] };

const initialState: CliState = {
  phase: "menu",
  command: null,
  selectedProfile: null,
  configAnswers: {},
  missingVars: [],
  configIndex: 0,
  reviewResult: null,
  reviewError: "",
  reviewStatus: "Starting review...",
  prInfo: null,
  manageProfileName: null,
  manageMessage: null,
  isEditOnly: false,
  configOrigin: "menu",
};

function reducer(state: CliState, action: CliAction): CliState {
  switch (action.type) {
    case "SET_PHASE":
      return { ...state, phase: action.phase };
    case "SET_COMMAND":
      return { ...state, command: action.command };
    case "SELECT_PROFILE":
      return { ...state, selectedProfile: action.profile };
    case "SET_CONFIG_ANSWERS":
      return { ...state, configAnswers: action.answers };
    case "SET_MISSING_VARS":
      return { ...state, missingVars: action.vars };
    case "SET_CONFIG_INDEX":
      return { ...state, configIndex: action.index };
    case "CONFIG_BACK":
      return {
        ...state,
        configIndex: action.prevIndex,
        configAnswers: action.answers,
        ...(action.vars ? { missingVars: action.vars } : {}),
      };
    case "SET_REVIEW_STATUS":
      return { ...state, reviewStatus: action.status };
    case "REVIEW_STARTED":
      return {
        ...state,
        prInfo: action.prInfo,
        phase: "reviewing",
        reviewStatus: `Reviewing PR #${action.prInfo.prId} in ${action.prInfo.project}/${action.prInfo.repo}...`,
      };
    case "REVIEW_COMPLETE":
      return { ...state, reviewResult: action.result, phase: "review-done" };
    case "REVIEW_ERROR":
      return { ...state, reviewError: action.error, phase: "review-error" };
    case "SET_MANAGE_PROFILE":
      return { ...state, manageProfileName: action.name };
    case "SET_MANAGE_MESSAGE":
      return { ...state, manageMessage: action.message };
    case "SET_EDIT_ONLY":
      return { ...state, isEditOnly: action.isEditOnly };
    case "START_CONFIG":
      return {
        ...state,
        missingVars: action.vars,
        configIndex: 0,
        configAnswers: action.answers,
        configOrigin: action.origin,
        isEditOnly: action.isEditOnly ?? false,
        phase: "config",
      };
    case "BATCH":
      return action.actions.reduce(reducer, state);
    default:
      return state;
  }
}

export function useCliReducer(overrides?: Partial<CliState>) {
  return useReducer(reducer, { ...initialState, ...overrides });
}
