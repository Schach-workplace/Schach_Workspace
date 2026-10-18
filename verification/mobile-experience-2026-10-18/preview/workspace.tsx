// Explicit fictional component fixture: no session, API, storage or provider.
export function useWorkspace() {
  return {
    session: null,
    error: new URLSearchParams(location.search).has("error")
      ? "Fictional connection failure. Check your connection and try again."
      : "",
    signIn: async () => {
      throw Error("Preview only: sign-in is disabled.");
    },
    setError: () => {},
  };
}
