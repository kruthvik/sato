/** Runtime-neutral lifecycle boundary; education-specific contracts belong here later. */
export interface DisposableRuntime {
  dispose(): Promise<void>;
}

export * from "./contracts.ts";
export { subjectProfiles } from "./subjects.ts";
