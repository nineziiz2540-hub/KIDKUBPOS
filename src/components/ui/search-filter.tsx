"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"

function SearchFilter<T>({
  items,
  filterKey,
  placeholder,
  children,
}: {
  items: T[]
  filterKey: keyof T
  placeholder: string
  children: (filtered: T[]) => React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const filtered =
    query.trim() === ""
      ? items
      : items.filter((item) =>
          String(item[filterKey]).toLowerCase().includes(query.toLowerCase())
        )

  return (
    <div className="space-y-4">
      <Input
        icon="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      {children(filtered)}
    </div>
  )
}

export { SearchFilter }
