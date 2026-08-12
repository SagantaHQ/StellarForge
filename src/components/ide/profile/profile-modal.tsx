"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Wallet,
  Check,
  AlertCircle,
  Loader2,
  User,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarUploader } from "./avatar-uploader";

/**
 * §11 — Profile modal.
 *
 * Wallet signing (SIWS) is performed ONCE at login — see ide-shell.tsx
 * `doSiwsLogin()`. The server creates the User + auto-generates a Profile.
 *
 * This modal is for editing the profile (username, bio, avatar). It posts
 * directly to /api/profile with the wallet address — no additional signing
 * needed because ownership was already proven during login.
 *
 * Flow:
 *   1. User opens the profile modal (e.g. by clicking the avatar)
 *   2. Username/bio/avatar are pre-filled from the existing profile
 *   3. User edits → clicks "Save profile" → POST /api/profile
 *   4. Server upserts the Profile (with username-lock enforcement)
 */

type Step = "wallet" | "profile" | "done";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (profile: { address: string; username: string; avatarUrl?: string; bio?: string }) => void;
  existingProfile?: { address: string; username: string; avatarUrl?: string; bio?: string; isCustomUsername?: boolean } | null;
  /** If the wallet is already connected, pass the address to skip the wallet step */
  walletAddress?: string | null;
  /** If true, the wallet is already connected — skip to profile step */
  walletConnected?: boolean;
}

export function ProfileModal({ open, onClose, onComplete, existingProfile, walletAddress, walletConnected }: ProfileModalProps) {
  const [step, setStep] = useState<Step>("wallet");
  const [address, setAddress] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [asyncUsernameStatus, setAsyncUsernameStatus] = useState<"checking" | "available" | "taken">("checking");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUsernameConfirm, setShowUsernameConfirm] = useState(false);
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the modal opens, determine which step to show.
  //
  // CRITICAL: If the wallet is already connected (walletConnected=true),
  // we MUST skip to the "profile" step — even if the server session check
  // returns loggedIn:false (e.g. user connected their wallet but hasn't
  // created a profile yet). The "wallet" step is ONLY for users who
  // haven't connected a wallet at all.
  //
  // We also fetch FRESH user data from the DB to pre-fill the form.
  useEffect(() => {
    if (!open) return;

    const addr = existingProfile?.address || walletAddress;

    // If wallet is connected, always go to profile step + set address
    if (walletConnected && addr) {
      setAddress(addr);
      setStep("profile");
    }

    if (!addr) return;

    setFetchingProfile(true);

    fetch(`/api/auth/session?address=${encodeURIComponent(addr)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.loggedIn && data?.profile) {
          // Server has a profile for this user — pre-fill fields
          setUsername(data.profile.username || "");
          setBio(data.profile.bio || "");
          setAvatarUrl(data.profile.avatarUrl || undefined);
          setUsernameLocked(!!data.profile.isCustomUsername);
          if (data.profile.username) {
            setAsyncUsernameStatus("available");
          }
          setStep("profile");
        } else if (existingProfile) {
          // Server says not logged in, but we have a cached profile —
          // use cached data. User can still edit + save.
          setUsername(existingProfile.username || "");
          setBio(existingProfile.bio || "");
          setAvatarUrl(existingProfile.avatarUrl);
          setUsernameLocked(!!existingProfile.isCustomUsername);
          setStep("profile");
        }
        // else: wallet connected, no profile in DB, no cached profile —
        // stay on "profile" step with empty fields (already set above
        // by the walletConnected check). User fills in username + saves.
      })
      .catch(() => {
        // Network error — fall back to existingProfile data
        if (existingProfile) {
          setUsername(existingProfile.username || "");
          setBio(existingProfile.bio || "");
          setAvatarUrl(existingProfile.avatarUrl);
          setUsernameLocked(!!existingProfile.isCustomUsername);
          setStep("profile");
        }
      })
      .finally(() => {
        setFetchingProfile(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // (The wallet-connected check is now handled in the first useEffect above —
  // if walletConnected is true, we skip to "profile" step immediately and
  // fetch fresh data in parallel.)

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        if (!existingProfile) {
          setStep("wallet");
          setAddress("");
        }
        setConnecting(false);
        setWalletError(null);
        if (!existingProfile) {
          setUsername("");
          setBio("");
          setAvatarUrl(undefined);
          setAsyncUsernameStatus("checking");
        }
        setSaving(false);
        setSaveError(null);
      }, 200);
    }
  }, [open, existingProfile]);

  const usernameStatus = useMemo<"idle" | "invalid" | "checking" | "available" | "taken">(() => {
    if (!username) return "idle";
    if (username.length < 3 || !/^[a-z0-9_]+$/i.test(username)) return "invalid";
    return asyncUsernameStatus;
  }, [username, asyncUsernameStatus]);

  useEffect(() => {
    if (step !== "profile") return;
    if (!username || username.length < 3 || !/^[a-z0-9_]+$/i.test(username)) return;
    // Skip availability check only if the username is truly locked (custom)
    if (usernameLocked) return;
    // Also skip if the username hasn't changed from the current one
    if (existingProfile?.username && existingProfile.username === username.toLowerCase()) {
      setAsyncUsernameStatus("available");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/check-username?u=${encodeURIComponent(username)}`);
        if (res.ok) {
          const data = await res.json();
          setAsyncUsernameStatus(data.available ? "available" : "taken");
        } else {
          setAsyncUsernameStatus("available");
        }
      } catch {
        setAsyncUsernameStatus("available");
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username, step, existingProfile]);

  if (!open) return null;

  async function handleSaveProfile() {
    if (usernameStatus !== "available") return;
    if (!address) return;

    // Check if the username is being changed (not just updating bio/avatar)
    const isUsernameChange = !usernameLocked &&
      (!existingProfile?.username || existingProfile.username !== username.toLowerCase());

    // If the username is being changed, show confirmation popup first
    if (isUsernameChange && !showUsernameConfirm) {
      setShowUsernameConfirm(true);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          username,
          bio: bio.trim() || undefined,
          avatarUrl: avatarUrl || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status >= 500) {
          throw new Error("Server error — please try again");
        }
        const msg = err.field === "username"
          ? `${err.error}`
          : err.error ?? `Save failed (${res.status})`;
        throw new Error(msg);
      }

      // Lock the username in the UI after successful save
      if (isUsernameChange) {
        setUsernameLocked(true);
      }

      // Re-fetch the profile from the server to get the updated isCustomUsername
      try {
        const sessionRes = await fetch(`/api/auth/session?address=${encodeURIComponent(address)}`);
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData?.loggedIn && sessionData?.profile) {
            // Update local state with server data
            setUsername(sessionData.profile.username);
            setBio(sessionData.profile.bio || "");
            setAvatarUrl(sessionData.profile.avatarUrl || undefined);
          }
        }
      } catch {
        // Best-effort — the save already succeeded
      }

      onComplete({
        address,
        username,
        avatarUrl,
        bio: bio.trim() || undefined,
      });
      setStep("done");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setShowUsernameConfirm(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {step === "wallet" && "Connect Wallet"}
            {step === "profile" && "Complete Your Profile"}
            {step === "done" && "Welcome to Soroban.Build"}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {fetchingProfile && step === "profile" && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
              <span className="ml-2 text-[12px] text-[var(--text-muted)]">Loading profile…</span>
            </div>
          )}
          {!(fetchingProfile && step === "profile") && (
            <>
          {step === "wallet" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Connect a Stellar wallet to enable collaboration, comments, and line attribution.
                Your wallet address is your identity.
              </p>
              <Button
                onClick={() => {
                  setConnecting(true);
                  try {
                    // Open the <StellarAppKitModal> via the global handle.
                    // The modal handles wallet picking + SIWS automatically.
                    const handle = (window as unknown as { __walletModal?: { open: () => void } }).__walletModal;
                    handle?.open();
                  } catch (err) {
                    setWalletError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setConnecting(false);
                  }
                }}
                disabled={connecting}
                className="w-full gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
              >
                {connecting ? (
                  <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
                ) : (
                  <Wallet size={14} strokeWidth={1.75} />
                )}
                {connecting ? "Opening wallet…" : "Open wallet picker"}
              </Button>

              {walletError && (
                <div className="rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2.5 flex items-start gap-2">
                  <AlertCircle size={14} strokeWidth={1.75} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[var(--status-error)]">{walletError}</div>
                </div>
              )}
              <p className="pt-1 text-[10px] text-[var(--text-muted)]">
                Powered by <code className="font-mono">@saganta/stellar-appkit</code>
              </p>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-3">
              {/* Avatar uploader with crop */}
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1.5 block">
                  Avatar
                </label>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-raised)] shrink-0">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      <User size={20} strokeWidth={1.5} className="text-[var(--text-muted)]" />
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Square crop · WebP · 512×512 · Max 2MB
                  </span>
                </div>
                <AvatarUploader
                  address={address}
                  currentAvatar={avatarUrl}
                  onUploaded={(url) => setAvatarUrl(url)}
                  onCancel={() => {}}
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1 block">
                  Username{" "}
                  {usernameLocked ? (
                    <span className="text-[var(--text-muted)]">(locked — cannot be changed)</span>
                  ) : (
                    <span className="text-[var(--status-success)]">(changeable — once set, cannot be changed)</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    value={username}
                    onChange={(e) => {
                      if (!usernameLocked) {
                        setUsername(e.target.value);
                      }
                    }}
                    readOnly={usernameLocked}
                    placeholder="e.g. soroban-dev"
                    className={cn(
                      "w-full rounded border bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]",
                      usernameLocked && "opacity-60 cursor-not-allowed",
                      !usernameLocked && usernameStatus === "available" && "border-[var(--status-success)]",
                      !usernameLocked && usernameStatus === "taken" && "border-[var(--status-error)]",
                      !usernameLocked && usernameStatus === "invalid" && "border-[var(--status-warning)]",
                      !usernameLocked && (usernameStatus === "idle" || usernameStatus === "checking") && "border-[var(--border-subtle)] focus:border-[var(--accent)]"
                    )}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    {usernameStatus === "checking" && <Loader2 size={12} strokeWidth={1.75} className="animate-spin text-[var(--text-muted)]" />}
                    {usernameStatus === "available" && <Check size={13} strokeWidth={2} className="text-[var(--status-success)]" />}
                    {usernameStatus === "taken" && <X size={13} strokeWidth={2} className="text-[var(--status-error)]" />}
                    {usernameStatus === "invalid" && <AlertCircle size={12} strokeWidth={2} className="text-[var(--status-warning)]" />}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {usernameStatus === "idle" && "3+ chars, letters/numbers/underscore."}
                  {usernameStatus === "checking" && "Checking availability…"}
                  {usernameStatus === "available" && <span className="text-[var(--status-success)]">"{username}" is available</span>}
                  {usernameStatus === "taken" && <span className="text-[var(--status-error)]">"{username}" is already taken</span>}
                  {usernameStatus === "invalid" && <span className="text-[var(--status-warning)]">Must be 3+ chars, letters/numbers/underscore only</span>}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1 block">
                  Bio <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell others what you're building on Soroban…"
                  rows={2}
                  className="w-full resize-none rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
              </div>

              {saving && (
                <div className="rounded-md border border-[var(--accent)] bg-[var(--accent-subtle)] p-2.5 flex items-center gap-2">
                  <Loader2 size={14} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
                  <span className="text-[11px] text-[var(--text-secondary)]">Saving your profile…</span>
                </div>
              )}

              {saveError && (
                <div className="rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2.5 flex items-start gap-2">
                  <AlertCircle size={14} strokeWidth={1.75} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                  <div className="text-[11px] text-[var(--status-error)]">
                    <div className="font-medium">Could not save profile</div>
                    <div className="mt-0.5 opacity-90">{saveError}</div>
                  </div>
                </div>
              )}

              {showUsernameConfirm && (
                <div className="rounded-md border border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertCircle size={14} strokeWidth={1.75} className="text-[var(--status-warning)] mt-0.5 shrink-0" />
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      <div className="font-medium text-[var(--status-warning)]">Important: Username can only be changed once</div>
                      <div className="mt-1">
                        You are about to set your username to <span className="font-mono font-medium text-[var(--text-primary)]">{username}</span>.
                        After this, your username will be permanently locked and cannot be changed again.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowUsernameConfirm(false)}
                      className="rounded px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      className="rounded px-2.5 py-1 text-[11px] font-medium bg-[var(--status-warning)] text-black hover:opacity-90 transition-colors"
                    >
                      Yes, lock username
                    </button>
                  </div>
                </div>
              )}

              {!showUsernameConfirm && (
                <Button
                  onClick={handleSaveProfile}
                  disabled={usernameStatus !== "available" || saving}
                  className="w-full gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <Save size={14} strokeWidth={1.75} />}
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              )}

              <p className="text-[10px] text-[var(--text-muted)] text-center">
                Your wallet was verified when you signed in. No additional signature needed.
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-subtle)]">
                <Check size={24} strokeWidth={2} className="text-[var(--accent)]" />
              </div>
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">You're all set, {username}!</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Your profile is saved. You can now collaborate, comment, and your edits will be attributed.
              </p>
              <Button onClick={onClose} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]">
                Start building
              </Button>
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
