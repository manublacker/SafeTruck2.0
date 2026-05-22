import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Features from "@/components/landing/Features";
import Plans from "@/components/landing/Plans";
import About from "@/components/landing/About";
import Footer from "@/components/landing/Footer";

const Index = () => {
  return (
    <div id="top" className="tw-page font-sans min-h-screen bg-background">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Plans />
      <About />
      <Footer />
    </div>
  );
};

export default Index;
