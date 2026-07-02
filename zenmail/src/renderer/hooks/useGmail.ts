import type { ZenmailApi } from '../../shared/types';

/** Typed accessor for the contextBridge API exposed by the preload script. */
export function useGmail(): ZenmailApi {
  return window.zenmail;
}
