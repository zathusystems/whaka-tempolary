import { redirect } from 'next/navigation';

export default function Home() {
  // By default, redirect to the login page.
  // In a real app, you might check for an existing session here.
  redirect('/dashboard');
}
