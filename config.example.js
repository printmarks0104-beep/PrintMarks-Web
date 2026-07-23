(() => {
  const cfg = window.PRINTMARKS_CONFIG || {};
  const configured = Boolean(
    cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_PUBLIC")
  );
  const client = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (id) => document.getElementById(id);
  const show = (el) => el?.classList.remove("hidden");
  const hide = (el) => el?.classList.add("hidden");
  let currentUser = null;
  let currentProfile = null;
  let lastJobCode = "";

  const toast = (text) => {
    const el = $("toast");
    el.textContent = text;
    show(el);
    clearTimeout(el._timer);
    el._timer = setTimeout(() => hide(el), 4200);
  };

  const downloadUrl = cfg.DOWNLOAD_URL || "downloads/PrintMarks_Setup.exe";
  $("downloadAccount").href = downloadUrl;

  const requireClient = () => {
    if (!client) {
      toast("Portal is in design/demo mode. Configure SUPABASE_URL and SUPABASE_ANON_KEY in config.js to enable accounts and print jobs.");
      return false;
    }
    return true;
  };

  const switchPane = (pane) => {
    $("registerPane").classList.toggle("hidden", pane !== "register");
    $("loginPane").classList.toggle("hidden", pane !== "login");
    $("authMessage").textContent = "";
  };
  const openAuth = (pane = "register") => { show($("authModal")); switchPane(pane); };
  document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openAuth(b.dataset.open)));
  document.querySelectorAll("[data-switch]").forEach((b) => b.addEventListener("click", () => switchPane(b.dataset.switch)));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest(".modal")?.classList.add("hidden")));
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) hide(m); }));

  const params = new URLSearchParams(location.search);
  const incomingCode = (params.get("ref") || params.get("reseller") || "").toUpperCase();
  if (incomingCode) $("regReferral").value = incomingCode;
  if (location.hash === "#register") setTimeout(() => openAuth("register"), 100);

  const accountTypeChanged = () => {
    const isShop = $("regAccountType").value === "shop";
    $("businessField").classList.toggle("hidden", !isShop);
    $("regBusiness").required = isShop;
  };
  $("regAccountType").addEventListener("change", accountTypeChanged);
  accountTypeChanged();

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireClient()) return;
    const accountType = $("regAccountType").value;
    const businessName = $("regBusiness").value.trim();
    if (accountType === "shop" && !businessName) {
      $("authMessage").textContent = "Enter your printing shop or business name.";
      return;
    }
    $("authMessage").textContent = "Creating account…";
    const { error } = await client.auth.signUp({
      email: $("regEmail").value.trim().toLowerCase(),
      password: $("regPassword").value,
      options: {
        data: {
          full_name: $("regName").value.trim(),
          business_name: businessName,
          account_type: accountType,
          referral_code: $("regReferral").value.trim().toUpperCase()
        }
      }
    });
    $("authMessage").textContent = error
      ? error.message
      : "Account created. Verify your email, then log in. Printing-shop accounts appear in the shop directory after activation.";
    if (!error) e.target.reset();
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireClient()) return;
    $("authMessage").textContent = "Logging in…";
    const { error } = await client.auth.signInWithPassword({
      email: $("loginEmail").value.trim().toLowerCase(),
      password: $("loginPassword").value
    });
    if (error) { $("authMessage").textContent = error.message; return; }
    hide($("authModal"));
    await loadAccount();
    toast("Logged in successfully.");
  });

  async function loadShops() {
    const select = $("jobShop");
    if (!client) {
      select.innerHTML = '<option value="">Configure Supabase to load active shops</option>';
      return;
    }
    const { data, error } = await client
      .from("pm_print_shops")
      .select("id,shop_code,shop_name,address,contact_phone")
      .eq("is_active", true)
      .eq("accepts_walk_in", true)
      .order("shop_name");
    if (error) {
      select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
      return;
    }
    select.innerHTML = '<option value="">Select a printing shop</option>' + (data || []).map((shop) =>
      `<option value="${shop.id}">${escapeHtml(shop.shop_name)}${shop.address ? ` — ${escapeHtml(shop.address)}` : ""}</option>`
    ).join("");
  }

  async function loadAccount() {
    if (!client) return;
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    if (!user) { hide($("account")); return; }
    show($("account"));

    const { data: profile } = await client.from("pm_profiles").select("*").eq("user_id", user.id).maybeSingle();
    currentProfile = profile || {};
    $("accountGreeting").textContent = `Welcome, ${profile?.full_name || user.user_metadata?.full_name || user.email}`;
    $("accountTypeLabel").textContent = profile?.account_type === "shop" ? "Printing Shop / Desktop App Account" : "Print Customer Account";
    $("jobPickupName").value ||= profile?.full_name || user.user_metadata?.full_name || "";

    if (["shop", "owner", "reseller"].includes(profile?.account_type)) {
      const { error: shopError } = await client.rpc("pm_ensure_my_shop");
      if (shopError && !String(shopError.message).includes("not registered")) console.warn(shopError);
      await loadShops();
    }

    const [{ data: subs }, { data: refs }, { data: rewards }] = await Promise.all([
      client.from("pm_subscriptions").select("plan_name,status,expires_at,referral_reward_days").eq("customer_user_id", user.id).order("expires_at", { ascending: false, nullsFirst: false }),
      client.from("pm_referrals").select("id,status").eq("referrer_user_id", user.id),
      client.from("pm_referral_rewards").select("reward_days,status").eq("referrer_user_id", user.id)
    ]);
    const active = (subs || []).find((s) => ["active", "trial"].includes(String(s.status).toLowerCase()) && (!s.expires_at || new Date(s.expires_at) > new Date()));
    $("subscriptionStatus").textContent = active ? `${active.plan_name} • Active` : "Trial / No paid plan";
    $("subscriptionExpiry").textContent = active?.expires_at ? `Until ${new Date(active.expires_at).toLocaleDateString()}` : "";

    let code = "";
    const { data: codeRows } = await client.from("pm_referral_codes").select("code").eq("owner_user_id", user.id).eq("code_type", "referral").limit(1);
    code = codeRows?.[0]?.code || "";
    if (!code) { const { data } = await client.rpc("pm_ensure_my_referral_code"); code = data || ""; }
    $("referralCode").textContent = code || "—";
    const qualified = (refs || []).filter((r) => r.status === "qualified").length;
    const next = (Math.floor(qualified / 20) + 1) * 20;
    $("qualifiedCount").textContent = qualified;
    $("nextMilestone").textContent = next;
    $("referralProgress").style.width = `${((qualified % 20) / 20) * 100}%`;
    $("bonusDays").textContent = (rewards || []).filter((r) => r.status === "applied").reduce((a, r) => a + Number(r.reward_days || 0), 0);
    $("copyReferralBtn").onclick = async () => {
      const link = `${location.origin}${location.pathname}?ref=${encodeURIComponent(code)}`;
      await navigator.clipboard.writeText(link);
      toast("Referral link copied.");
    };
    await loadMyJobs();
  }

  $("logoutBtn").addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    currentUser = null;
    currentProfile = null;
    hide($("account"));
    location.hash = "home";
  });

  const openReseller = () => {
    if (!currentUser) { openAuth("login"); toast("Log in before applying as a reseller."); return; }
    $("resellerName").value = currentProfile?.full_name || currentUser.user_metadata?.full_name || "";
    $("resellerBusiness").value = currentProfile?.business_name || "";
    show($("resellerModal"));
  };
  $("applyResellerBtn").addEventListener("click", openReseller);
  $("accountResellerBtn").addEventListener("click", openReseller);
  $("resellerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!client || !currentUser) return;
    const payload = {
      user_id: currentUser.id,
      full_name: $("resellerName").value.trim(),
      business_name: $("resellerBusiness").value.trim(),
      phone: $("resellerPhone").value.trim(),
      sales_channel: $("resellerChannel").value.trim(),
      message: $("resellerMessage").value.trim(),
      status: "pending"
    };
    const { error } = await client.from("pm_reseller_applications").upsert(payload, { onConflict: "user_id" });
    $("resellerFormMessage").textContent = error ? error.message : "Application submitted for owner review.";
  });

  document.querySelectorAll(".plan-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (!client) { requireClient(); return; }
    const { data: { session } } = await client.auth.getSession();
    if (!session) { openAuth("login"); toast("Log in before choosing a plan."); return; }
    const { data, error } = await client.functions.invoke("create-checkout", { body: { plan: btn.dataset.plan } });
    toast(error?.message || data?.message || "Checkout request created.");
  }));

  const filesInput = $("jobFiles");
  const uploadZone = $("uploadZone");
  const updateSelectedFiles = () => {
    const files = Array.from(filesInput.files || []);
    $("selectedFiles").innerHTML = files.map((file) => `<i>${escapeHtml(file.name)} • ${formatBytes(file.size)}</i>`).join("");
  };
  filesInput.addEventListener("change", updateSelectedFiles);
  ["dragenter", "dragover"].forEach((evt) => uploadZone.addEventListener(evt, () => uploadZone.classList.add("dragging")));
  ["dragleave", "drop"].forEach((evt) => uploadZone.addEventListener(evt, () => uploadZone.classList.remove("dragging")));

  $("printJobForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireClient()) return;
    if (!currentUser) { openAuth("login"); toast("Log in before submitting a print job."); return; }
    const files = Array.from(filesInput.files || []);
    if (!files.length) { $("jobFormMessage").textContent = "Choose at least one file."; return; }
    if (files.length > 10) { $("jobFormMessage").textContent = "Maximum 10 files per job."; return; }
    const oversized = files.find((f) => f.size > 50 * 1024 * 1024);
    if (oversized) { $("jobFormMessage").textContent = `${oversized.name} is larger than 50 MB.`; return; }
    if (!$("jobShop").value) { $("jobFormMessage").textContent = "Select a printing shop."; return; }

    const submitBtn = $("submitJobBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading and submitting…";
    $("jobFormMessage").textContent = "";

    const jobPayload = {
      job_code: "",
      shop_id: $("jobShop").value,
      customer_user_id: currentUser.id,
      pickup_name: $("jobPickupName").value.trim(),
      customer_phone: $("jobPhone").value.trim(),
      service_type: $("jobService").value,
      paper_size: $("jobPaper").value,
      color_mode: $("jobColor").value,
      copies: Number($("jobCopies").value || 1),
      duplex: $("jobDuplex").checked,
      finishing: $("jobFinishing").value,
      pickup_method: "walk_in",
      payment_status: $("jobPayShop").checked ? "pay_at_shop" : "unpaid",
      instructions: $("jobInstructions").value.trim(),
      status: "submitted"
    };

    const { data: job, error: jobError } = await client.from("pm_print_jobs").insert(jobPayload).select().single();
    if (jobError) {
      submitBtn.disabled = false; submitBtn.textContent = "Submit Print Job";
      $("jobFormMessage").textContent = jobError.message;
      return;
    }

    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
        const unique = self.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const storagePath = `${currentUser.id}/${job.id}/${unique}-${safeName}`;
        const { error: uploadError } = await client.storage.from("printmarks-job-files").upload(storagePath, file, {
          cacheControl: "3600", upsert: false, contentType: file.type || undefined
        });
        if (uploadError) throw new Error(uploadError.message);
        const { error: fileRowError } = await client.from("pm_print_job_files").insert({
          job_id: job.id,
          customer_user_id: currentUser.id,
          shop_owner_user_id: job.shop_owner_user_id,
          storage_path: storagePath,
          original_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size
        });
        if (fileRowError) throw new Error(fileRowError.message);
      }
    } catch (uploadError) {
      await client.from("pm_print_jobs").update({ status: "cancelled", shop_note: `Upload failed: ${uploadError.message}` }).eq("id", job.id);
      submitBtn.disabled = false; submitBtn.textContent = "Submit Print Job";
      $("jobFormMessage").textContent = `Upload failed. The incomplete job was cancelled: ${uploadError.message}`;
      return;
    }

    lastJobCode = job.job_code;
    $("successJobCode").textContent = job.job_code;
    show($("jobSuccessModal"));
    e.target.reset();
    updateSelectedFiles();
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Print Job";
    await loadMyJobs();
  });

  $("copyJobCodeBtn").addEventListener("click", async () => {
    if (!lastJobCode) return;
    await navigator.clipboard.writeText(lastJobCode);
    toast("Job ID copied.");
  });

  async function loadMyJobs() {
    if (!client || !currentUser) return;
    const container = $("myJobs");
    container.innerHTML = '<div class="empty-state">Loading jobs…</div>';
    const { data, error } = await client
      .from("pm_print_jobs")
      .select("id,job_code,service_type,paper_size,color_mode,copies,duplex,finishing,status,quoted_amount,payment_status,file_count,submitted_at,shop_note,pm_print_shops(shop_name)")
      .eq("customer_user_id", currentUser.id)
      .order("submitted_at", { ascending: false });
    if (error) { container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty-state">No print jobs submitted yet.</div>'; return; }
    container.innerHTML = data.map((job) => {
      const cancellable = job.status === "submitted";
      return `<article class="job-card">
        <div><h3>${escapeHtml(job.job_code)}</h3><small>${new Date(job.submitted_at).toLocaleString()} • ${escapeHtml(job.pm_print_shops?.shop_name || "Print shop")}</small></div>
        <div class="meta"><b>${humanService(job.service_type)}</b><br>${escapeHtml(job.paper_size || "—")} • ${escapeHtml(job.color_mode || "—")} • ${job.copies} cop${job.copies === 1 ? "y" : "ies"}${job.duplex ? " • Duplex" : ""}<br>${job.file_count || 0} file(s)</div>
        <div><span class="status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span><div class="meta">${job.quoted_amount != null ? `Quote: ₱${Number(job.quoted_amount).toFixed(2)}` : "Awaiting shop quotation"}<br>${escapeHtml(job.shop_note || "")}</div></div>
        <div>${cancellable ? `<button class="ghost cancel-job" data-job="${job.id}" style="color:#b91c1c;border-color:#fecaca">Cancel</button>` : ""}</div>
      </article>`;
    }).join("");
    container.querySelectorAll(".cancel-job").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Cancel this submitted print job?")) return;
      const { error: cancelError } = await client.from("pm_print_jobs").update({ status: "cancelled" }).eq("id", button.dataset.job);
      if (cancelError) toast(cancelError.message); else { toast("Print job cancelled."); await loadMyJobs(); }
    }));
  }

  $("refreshJobsBtn").addEventListener("click", loadMyJobs);

  function humanService(value) {
    return ({ document_print: "Document Printing", image_docs: "Image Documents", photo_print: "Photo Printing", rush_id: "Rush ID / Passport", sticker: "Sticker Printing", tarpaulin: "Tarpaulin Printing", calling_card: "Calling Card", other: "Other Service" })[value] || value || "Print Job";
  }
  function formatBytes(bytes) {
    if (!Number(bytes)) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  if (client) {
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      if (currentUser) loadAccount(); else hide($("account"));
    });
    client.auth.getSession().then(({ data }) => { if (data.session) loadAccount(); });
  }
  loadShops();
})();
