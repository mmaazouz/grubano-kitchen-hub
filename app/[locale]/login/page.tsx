import { redirect } from 'next/navigation'

// The multi-portal login selector is retired. A single unified sign-in page
// (Bolt consumer design) now handles ALL roles and routes by role after login.
export default function LoginRedirect() {
  redirect('/eat/auth')
}
