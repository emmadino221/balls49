import React from 'react';
import HomePage from './pages/HomePage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import TestimonialsPage from './pages/TestimonialsPage.jsx';
import FreeTrialPage from './pages/FreeTrialPage.jsx';
import ContactPage from './pages/ContactPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import GuidePage from './pages/GuidePage.jsx';
import PredictionsPage from './pages/PredictionsPage.jsx';
import CalculatorPage from './pages/CalculatorPage.jsx';

export function getPageName() {
  const route = window.location.pathname.replace(/^\/|\/index.html$/g, '').replace(/^\/|\/$/, '');
  if (!route || route === 'index.html') return 'home';
  if (route === 'about.html') return 'about';
  if (route === 'pricing.html') return 'pricing';
  if (route === 'testimonials.html') return 'testimonials';
  if (route === 'history.html') return 'history';
  if (route === 'guide.html') return 'guide';
  if (route === 'calculator.html') return 'calculator';
  if (route === 'predictions.html') return 'predictions';
  if (route === 'free-trial.html') return 'free-trial';
  if (route === 'contact.html') return 'contact';
  if (route === 'login.html') return 'login';
  if (route === 'signup.html') return 'signup';
  return 'home';
}

export function PageRenderer({ page }) {
  if (page === 'about') return <AboutPage />;
  if (page === 'pricing') return <PricingPage />;
  if (page === 'testimonials') return <TestimonialsPage />;
  if (page === 'history') return <HistoryPage />;
  if (page === 'guide') return <GuidePage />;
  if (page === 'calculator') return <CalculatorPage />;
  if (page === 'predictions') return <PredictionsPage />;
  if (page === 'free-trial') return <FreeTrialPage />;
  if (page === 'contact') return <ContactPage />;
  if (page === 'login') return <LoginPage />;
  if (page === 'signup') return <SignupPage />;
  return <HomePage />;
}
