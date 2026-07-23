PRINTMARKS WEB V36 — PUBLIC GITHUB PAGES SETUP
==============================================

1. Create a PUBLIC GitHub repository named PrintMarks-Web.
2. Upload the CONTENTS of this folder to the repository root.
3. Open Settings > Secrets and variables > Actions > Variables.
4. Create these repository variables:

   PRINTMARKS_SUPABASE_URL
   PRINTMARKS_SUPABASE_PUBLISHABLE_KEY
   PRINTMARKS_DOWNLOAD_URL
   PRINTMARKS_SUPPORT_EMAIL

5. PRINTMARKS_DOWNLOAD_URL should point to the public installer release, for example:

   https://github.com/YOUR-NAME/PrintMarks-Downloads/releases/latest/download/PrintMarks_Setup.exe

6. Open Settings > Pages and choose GitHub Actions as the source.
7. Open Actions > Deploy PrintMarks web portal > Run workflow.
8. Your site will be available at:

   https://YOUR-NAME.github.io/PrintMarks-Web/

Never put a service_role, sb_secret_, payment secret, or signing key in this repository.
The Supabase publishable key is intended for public clients; protect data with RLS policies.
