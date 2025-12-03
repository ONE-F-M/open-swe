"use client";

import { DefaultView } from "@/components/v2/default-view";
import { useThreadsSWR } from "@/hooks/useThreadsSWR";
import { GitHubAppProvider, useGitHubAppProvider } from "@/providers/GitHubApp";
import { Toaster } from "@/components/ui/sonner";
import { Suspense, useEffect} from "react";
import { MANAGER_GRAPH_ID } from "@openswe/shared/constants";

function ChatPageComponent() {
  const { currentInstallation,error } = useGitHubAppProvider();
  const { threads, isLoading: threadsLoading } = useThreadsSWR({
    assistantId: MANAGER_GRAPH_ID,
    currentInstallation,
  });

useEffect(() => {
    if (error && typeof window !== "undefined") {
      // If error looks like an auth/session error, redirect
      if (error.toLowerCase().includes("401") || error.toLowerCase().includes("unauthorized") || error.toLowerCase().includes("bad credentials") || error.toLowerCase().includes("session")) {
        window.location.href = "/api/auth/github/login";
      }
    }
  }, [error]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <p className="text-red-500 mb-4">Session expired or authentication error. Redirecting to login...</p>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded"
          onClick={() => (window.location.href = "/api/auth/github/login")}
        >
          Login with GitHub
        </button>
      </div>
    );
  }

  if (!threads) {
    return <div>No threads</div>;
  }

  return (
    <div className="bg-background h-screen">
      <Suspense>
        <Toaster />
        <DefaultView
          threads={threads}
          threadsLoading={threadsLoading}
        />
      </Suspense>
    </div>
  );
}

export default function ChatPage() {
  return (
    <GitHubAppProvider>
      <ChatPageComponent />
    </GitHubAppProvider>
  );
}
