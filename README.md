# Golf Charity Club

This is a responsive Supabase-backed web app for the PRD in your screenshots. Authentication, subscriptions, scores, draws, winners, and charity-facing data are intended to run from Supabase.

## Included modules

- Simple public view with lightweight login and signup
- Role-based authentication for `admin` and `user` using Supabase Auth
- Supabase-ready SQL schema for profiles, subscriptions, scores, draws, charities, and winner verification
- Public landing area with subscription plans and charity directory
- Subscriber onboarding with monthly or yearly plans
- Score submission with validation and automatic retention of the last 5 scores
- Prize pool calculation, weighted monthly draws, and jackpot rollover
- Charity contribution tracking
- Admin controls for draw publishing, subscription access, winner verification, and analytics

## Supabase setup

1. Open [supabase-config.js](C:\Users\tok2s\OneDrive\Documents\New project\supabase-config.js)
2. Replace the placeholder values with your real:
   - `Project URL`
   - `anon public key`
3. In your Supabase dashboard, open SQL Editor
4. Run the full SQL from [supabase-schema.sql](C:\Users\tok2s\OneDrive\Documents\New project\supabase-schema.sql)
5. In Supabase Auth, enable Email/Password sign-in
6. If you do not want email confirmation during testing, disable `Confirm email` in Supabase Auth settings
7. To create an administrator, create the auth user first and then update `profiles.role` to `admin`

## Run locally

Serve the frontend with a simple static server:

```powershell
python -m http.server 8000
```

Then visit `http://127.0.0.1:8000`.

## Notes

- Auth is handled by Supabase
- App data is expected to come from Supabase tables
- The app hides login/signup after successful login and shows it again after logout
- `server.py` is no longer required for login/signup once Supabase is configured
- If your database was created from an older schema, re-run [supabase-schema.sql](C:\Users\tok2s\OneDrive\Documents\New project\supabase-schema.sql) so new columns and score rules are present
