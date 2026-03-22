import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  level: string | null;
  className?: string;
}

export function ConfidenceBadge({ level, className }: ConfidenceBadgeProps) {
  if (!level) return null;

  const variants: Record<string, string> = {
    strong: "bg-green-600 text-white hover:bg-green-700",
    moderate: "bg-yellow-600 text-white hover:bg-yellow-700",
    speculative: "bg-zinc-500 text-white hover:bg-zinc-600",
  };

  return (
    <Badge className={cn(variants[level] || variants.speculative, className)}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </Badge>
  );
}
