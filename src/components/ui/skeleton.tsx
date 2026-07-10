import { cn } from "@/lib/utils";

/**
 * Content-shaped loading placeholder. Product register calls for skeletons over
 * spinners: they preserve layout and reduce perceived wait. Pulse is disabled
 * under prefers-reduced-motion.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
