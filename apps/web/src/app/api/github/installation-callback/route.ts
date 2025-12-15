import { GITHUB_INSTALLATION_ID_COOKIE } from "@openswe/shared/constants";
import {
  GITHUB_INSTALLATION_RETURN_TO_COOKIE,
  GITHUB_INSTALLATION_STATE_COOKIE,
  getInstallationCookieOptions,
} from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handles callbacks from GitHub App installations
 * This endpoint is called by GitHub after a user installs or configures the GitHub App
 */
export async function GET(request: NextRequest) {
  // Debug: print all cookies
  const allCookies = request.cookies.getAll().map(c => ({ name: c.name, value: c.value }));
  console.log("[installation-callback] All cookies:", allCookies);
  try {
    console.log("[installation-callback] Incoming request:", request.url);
    const { searchParams } = new URL(request.url);
    const installationId = searchParams.get("installation_id");

    console.log("[installation-callback] installationId from query:", installationId);

    // Get the return URL from cookies
    const returnTo =
      request.cookies.get(GITHUB_INSTALLATION_RETURN_TO_COOKIE)?.value || "/";

    console.log("[installation-callback] returnTo from cookie:", returnTo);

    // Verify state parameter to prevent CSRF attacks
    // GitHub App installation doesn't return the state directly, but we included it in our callback URL
    const customState = searchParams.get("custom_state");
    const storedState = request.cookies.get(
      GITHUB_INSTALLATION_STATE_COOKIE,
    )?.value;

    console.log("[installation-callback] customState:", customState, "storedState:", storedState);

    // Validate state if it exists
    if (storedState && customState && storedState !== customState) {
      console.warn("Invalid installation state detected");
      // We'll still proceed but log the warning
    }

      // Force all post-auth redirects to ngrok URL, ignoring cookies/headers
      const response = NextResponse.redirect("https://doughtier-unscribal-eden.ngrok-free.dev/");

    // Debug: log before setting cookies
    console.log("[installation-callback] Setting expired cookies and installationId if present");

    // Clear cookies as they're no longer needed
    const expiredCookieOptions = {
      expires: new Date(0),
      path: "/",
    };

    response.cookies.set(
      GITHUB_INSTALLATION_RETURN_TO_COOKIE,
      "",
      expiredCookieOptions,
    );
    response.cookies.set(
      GITHUB_INSTALLATION_STATE_COOKIE,
      "",
      expiredCookieOptions,
    );

    // If we have an installation ID, store it in a cookie
    if (installationId) {
      console.log("[installation-callback] Setting GITHUB_INSTALLATION_ID_COOKIE:", installationId);
      response.cookies.set(
        GITHUB_INSTALLATION_ID_COOKIE,
        installationId,
        getInstallationCookieOptions(),
      );
    } else {
      // Try to fetch user's installations using the user token from cookie
      const userToken = request.cookies.get("github_token")?.value;
      if (userToken) {
        try {
          const userInstallationsRes = await fetch("https://api.github.com/user/installations", {
            headers: {
              Authorization: `Bearer ${userToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "OpenSWE-Agent"
            }
          });
          if (userInstallationsRes.ok) {
            const userInstallations = await userInstallationsRes.json();
            const firstInstallation = userInstallations.installations?.[0];
            if (firstInstallation?.id) {
              console.log("[installation-callback] Setting GITHUB_INSTALLATION_ID_COOKIE from user installations:", firstInstallation.id);
              response.cookies.set(
                GITHUB_INSTALLATION_ID_COOKIE,
                String(firstInstallation.id),
                getInstallationCookieOptions(),
              );
            } else {
              console.warn("[installation-callback] No installations found for user");
            }
          } else {
            console.warn("[installation-callback] Failed to fetch user installations", await userInstallationsRes.text());
          }
        } catch (err) {
          console.error("[installation-callback] Error fetching user installations:", err);
        }
      } else {
        console.warn("[installation-callback] No github_token cookie found, cannot fetch installations");
      }
    }

    console.log("[installation-callback] Response ready, returning");
    return response;
  } catch (error) {
    console.error("GitHub App installation callback error:", error);
    return NextResponse.redirect(
      new URL("/?error=installation_callback_failed", request.url),
    );
  }
}
