export default function PageLoading({
  label = "Loading workspace"
}: {
  label?: string;
}) {
  return (
    <div className="page-loading" role="status">
      [ {label}… ]
    </div>
  );
}
