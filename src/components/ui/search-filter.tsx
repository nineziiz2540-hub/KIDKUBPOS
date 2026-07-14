"use client"

import { useRef } from "react"
import { Input } from "@/components/ui/input"

function SearchFilter({
  placeholder,
  emptyMessage,
  children,
}: {
  placeholder: string
  emptyMessage: string
  children: React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const query = e.target.value.trim().toLowerCase()
    const container = containerRef.current
    if (!container) return

    const rows = container.querySelectorAll<HTMLElement>("[data-search-value]")
    let anyVisible = false
    rows.forEach((row) => {
      const value = row.dataset.searchValue?.toLowerCase() ?? ""
      const match = query === "" || value.includes(query)
      row.style.display = match ? "" : "none"
      if (match) anyVisible = true
    })

    const emptyEl = container.querySelector<HTMLElement>("[data-empty-message]")
    if (emptyEl) {
      // Tailwind's `hidden` class sets display:none in the stylesheet;
      // clearing the inline style ("") falls back to that class, not to
      // visible — an explicit value is required to actually reveal it.
      emptyEl.style.display = query !== "" && !anyVisible ? "flex" : "none"
    }
  }

  return (
    <div className="space-y-4">
      <Input
        icon="search"
        placeholder={placeholder}
        onChange={handleChange}
        className="max-w-xs"
      />
      <div ref={containerRef} className="relative min-h-20">
        {children}
        <p
          data-empty-message
          className="hidden absolute inset-0 items-center justify-center rounded-lg border bg-white px-4 py-8 text-center text-muted-foreground"
        >
          {emptyMessage}
        </p>
      </div>
    </div>
  )
}

export { SearchFilter }
