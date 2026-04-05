"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";

export interface CrawlOptions {
  url: string;
  maxDepth: number;
  maxPages: number;
  useJs: boolean;
  respectRobotsTxt: boolean;
}

export function CrawlForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (options: CrawlOptions) => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(500);
  const [useJs, setUseJs] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onSubmit({ url: url.trim(), maxDepth, maxPages, useJs, respectRobotsTxt: true });
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="url">Starting URL</Label>
          <Input
            id="url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Max Depth: {maxDepth}</Label>
          <Slider
            min={1}
            max={10}
            step={1}
            value={[maxDepth]}
            onValueChange={(v) => setMaxDepth(Array.isArray(v) ? v[0] : v)}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pages">Max Pages</Label>
          <Input
            id="pages"
            type="number"
            min={1}
            max={5000}
            value={maxPages}
            onChange={(e) => setMaxPages(parseInt(e.target.value) || 500)}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="js"
            checked={useJs}
            onCheckedChange={setUseJs}
            disabled={disabled}
          />
          <Label htmlFor="js">Use JavaScript rendering (slower)</Label>
        </div>

        <Button type="submit" disabled={disabled || !url.trim()} className="w-full">
          Start Crawl
        </Button>
      </form>
    </Card>
  );
}
