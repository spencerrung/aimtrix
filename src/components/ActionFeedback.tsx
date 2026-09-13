export function ActionFeedback({ busy, error, success }: { busy?: string; error?: string; success?: string }) {
  return <>
    <p className="interaction-feedback" role="status" aria-atomic="true">{busy || success || ''}</p>
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
  </>;
}
