// No hooks, no "use client": rendered by the public receipt page (server) and the Settings preview (client).
export function ReceiptBrand({
  logoUrl,
  shopName,
  size,
}: {
  logoUrl: string | null;
  shopName: string;
  size: "full" | "small";
}) {
  const full = size === "full";
  if (logoUrl) {
    return (
      <div
        className="mx-auto flex items-center justify-center"
        style={{ width: full ? 170 : 96, height: full ? 100 : 66 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={shopName} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <p
      className="text-center text-sidebar break-words"
      style={{ fontSize: full ? 20 : 16, fontWeight: 600 }}
    >
      {shopName}
    </p>
  );
}
