declare module "zustand" {
  type SetState<TState> = (
    partial: Partial<TState> | ((state: TState) => Partial<TState>),
    replace?: boolean,
  ) => void;

  type GetState<TState> = () => TState;

  type StateCreator<TState> = (set: SetState<TState>, get: GetState<TState>) => TState;

  export function create<TState>(): (initializer: StateCreator<TState>) => () => TState;
}

declare module "zustand/middleware" {
  import type { StateCreator } from "zustand";

  export function devtools<TState>(
    initializer: StateCreator<TState>,
    options?: unknown,
  ): StateCreator<TState>;

  export function persist<TState>(
    initializer: StateCreator<TState>,
    options?: unknown,
  ): StateCreator<TState>;
}
