"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Sun/moon button that flips between light and dark. Lives in the topbar, so
 * it's reachable on desktop and mobile. The icon is chosen with `dark:` CSS
 * variants rather than JS state — next-themes sets `.dark` on <html> before
 * paint, so there's no hydration mismatch and no flash.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() =>
        setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")
      }
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </button>
  );
}
