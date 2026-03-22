import { cn } from "@/lib/utils";

interface FormFiguresProps {
  positions: (number | null)[];
  className?: string;
}

export function FormFigures({ positions, className }: FormFiguresProps) {
  if (!positions.length) {
    return <span className={cn("text-muted-foreground text-sm", className)}>No form</span>;
  }

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {positions.map((pos, i) => {
        const display = pos === null ? "-" : pos.toString();
        let color = "text-muted-foreground";
        if (pos === 1) color = "text-green-500 font-bold";
        else if (pos === 2) color = "text-blue-400 font-semibold";
        else if (pos === 3) color = "text-yellow-500 font-semibold";
        else if (pos !== null && pos <= 5) color = "text-foreground";

        return (
          <span key={i} className={cn("text-sm tabular-nums", color)}>
            {display}
            {i < positions.length - 1 && (
              <span className="text-muted-foreground/50">-</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
