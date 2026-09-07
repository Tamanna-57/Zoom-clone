"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { FullPageSpinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";

export default function IndexPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/home" : "/login");
  }, [user, loading, router]);

  return <FullPageSpinner label="Starting Zoomeet" />;
}
