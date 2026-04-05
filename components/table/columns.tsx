"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "./data-table-column-header";
import type { CrawlResult } from "@/lib/types";

export const columns: ColumnDef<CrawlResult>[] = [
  {
    accessorKey: "url",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="URL" />
    ),
    cell: ({ row }) => {
      const url = row.getValue("url") as string;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline truncate max-w-[300px] block"
        >
          {url}
        </a>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as number;
      return (
        <Badge variant={status < 400 ? "default" : "destructive"}>
          {status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "depth",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Depth" />
    ),
  },
  {
    accessorKey: "title",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Title" />
    ),
    cell: ({ row }) => {
      const title = row.getValue("title") as string | null;
      return (
        <span className="truncate max-w-[200px] block">
          {title || "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "esIndexable",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Indexable" />
    ),
    cell: ({ row }) => {
      const indexable = row.getValue("esIndexable") as boolean;
      return (
        <Badge variant={indexable ? "default" : "secondary"}>
          {indexable ? "Yes" : "No"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "inlinks",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Inlinks" />
    ),
  },
];
