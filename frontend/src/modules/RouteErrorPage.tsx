import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/** Shown when a screen throws while rendering, instead of a blank page. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  const status = isRouteErrorResponse(error) ? error.status : null;
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
      <Brand />
      <div className="mt-8 flex size-10 items-center justify-center rounded-md bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h1 className="mt-3 text-base font-semibold">{status === 404 ? "Page not found" : "Something went wrong"}</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted">
        {status === 404 ? "The page you're looking for doesn't exist." : "This screen hit an unexpected error. Reloading usually fixes it."}
      </p>
      <div className="mt-5 flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Button variant="secondary" onClick={() => window.location.assign("/")}>
          Go to overview
        </Button>
      </div>
    </div>
  );
}
