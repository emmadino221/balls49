import AutomationPage from './pages/AutomationPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import TermsPage from './pages/TermsPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import FootballPage from './pages/FootballPage.jsx';
import React from 'react';
import HomePage from './pages/HomePage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import SuggestionsPage from './pages/SuggestionsPage.jsx';
import VideosPage from './pages/VideosPage.jsx';
import FreeTrialPage from './pages/FreeTrialPage.jsx';
import ContactPage from './pages/ContactPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import GuidePage from './pages/GuidePage.jsx';
import PredictionsPage from './pages/PredictionsPage.jsx';
import CalculatorPage from './pages/CalculatorPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';

export function getPageName() {
  if (window.location.pathname === '/terms.html') return 'terms';
  if (window.location.pathname === '/privacy.html') return 'privacy';
  const route = window.location.pathname.replace(/^\/|\/index.html$/g, '').replace(/^\/|\/$/, '');
  if (!route || route === 'index.html') return 'home';
  if (route === 'automation.html') return 'automation';
  if (route === 'football.html') return 'football';
  if (route === 'about.html') return 'about';
  if (route === 'pricing.html') return 'pricing';
  if (route === 'testimonials.html' || route === 'suggestions.html') return 'suggestions';
  if (route === 'videos.html') return 'videos';
  if (route === 'history.html') return 'history';
  if (route === 'guide.html') return 'guide';
  if (route === 'calculator.html') return 'calculator';
  if (route === 'predictions.html') return 'predictions';
  if (route === 'free-trial.html') return 'free-trial';
  if (route === 'contact.html') return 'contact';
  if (route === 'login.html') return 'login';
  if (route === 'verify-email.html') return 'verify-email';
  if (route === 'signup.html') return 'signup';
  if (route === 'account.html') return 'account';
  if (route === 'analysis.html') return 'analysis';
  return 'home';
}

export function PageRenderer({ page }) {
  if (page === 'terms') return <TermsPage />;
  if (page === 'privacy') return <PrivacyPage />;
  if (page === 'automation') return <AutomationPage />;
  if (page === 'football') return <FootballPage />;
  if (page === 'analysis') return <AnalysisPage />;
  if (page === 'account') return <AccountPage />;
  if (page === 'about') return <AboutPage />;
  if (page === 'pricing') return <PricingPage />;
  if (page === 'suggestions') return <SuggestionsPage />;
  if (page === 'videos') return <VideosPage />;
  if (page === 'history') return <HistoryPage />;
  if (page === 'guide') return <GuidePage />;
  if (page === 'calculator') return <CalculatorPage />;
  if (page === 'predictions') return <PredictionsPage />;
  if (page === 'free-trial') return <FreeTrialPage />;
  if (page === 'contact') return <ContactPage />;
  if (page === 'login') return <LoginPage />;
  if (page === 'verify-email') return <VerifyEmailPage />;
  if (page === 'signup') return <SignupPage />;
  return <HomePage />;
}
