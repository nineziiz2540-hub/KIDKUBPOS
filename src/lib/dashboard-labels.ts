// Small, client-safe home for dashboard label constants shared between
// server-only data-access code (src/lib/dal.ts, which has `import "server-only"`
// and cannot be imported from "use client" components) and client components
// like category-performance-chart.tsx. Keep this file free of server-only
// imports.

// Label used for order items with no category assigned.
export const UNCATEGORIZED_LABEL = "ไม่มีหมวดหมู่";
