/* ============================================
   BevAlc Intelligence - Animation Controller
   Scroll reveals, parallax, and interactions
   ============================================ */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        revealThreshold: 0.15,
        revealRootMargin: '0px 0px -50px 0px',
        parallaxIntensity: 0.3,
        navScrollThreshold: 50
    };

    // Debounce utility
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Throttle utility
    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ==========================================
    // SCROLL REVEAL ANIMATIONS
    // ==========================================

    function initScrollReveal() {
        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // Make all reveal elements visible immediately
            document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger-children')
                .forEach(el => el.classList.add('visible'));
            return;
        }

        const revealElements = document.querySelectorAll(
            '.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger-children'
        );

        if (revealElements.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // Optional: unobserve after revealing (better performance)
                    // observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: CONFIG.revealThreshold,
            rootMargin: CONFIG.revealRootMargin
        });

        revealElements.forEach(el => observer.observe(el));
    }

    // ==========================================
    // NAVIGATION SCROLL EFFECT
    // ==========================================

    function initNavScroll() {
        const nav = document.querySelector('.nav');
        if (!nav) return;

        const handleScroll = throttle(() => {
            if (window.scrollY > CONFIG.navScrollThreshold) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }, 100);

        window.addEventListener('scroll', handleScroll, { passive: true });
    }

    // ==========================================
    // PARALLAX EFFECTS
    // ==========================================

    function initParallax() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const parallaxElements = document.querySelectorAll('.parallax-slow, .parallax-fast');
        if (parallaxElements.length === 0) return;

        const handleParallax = throttle(() => {
            const scrollY = window.scrollY;

            parallaxElements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const speed = el.classList.contains('parallax-fast') ? 0.5 : 0.2;
                const yPos = (rect.top + scrollY) * speed * -1;
                el.style.transform = `translateY(${yPos}px)`;
            });
        }, 16); // ~60fps

        window.addEventListener('scroll', handleParallax, { passive: true });
    }

    // ==========================================
    // SMOOTH SCROLL TO ANCHORS
    // ==========================================

    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#') return;

                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    const navHeight = document.querySelector('.nav')?.offsetHeight || 0;
                    const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    // ==========================================
    // MAGNETIC BUTTON EFFECT
    // ==========================================

    function initMagneticButtons() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if ('ontouchstart' in window) return; // Skip on touch devices

        const buttons = document.querySelectorAll('.btn-glow, .nav-cta');

        buttons.forEach(btn => {
            btn.addEventListener('mousemove', (e) => {
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;

                btn.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px)`;
            });

            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
            });
        });
    }

    // ==========================================
    // TILT EFFECT ON CARDS
    // ==========================================

    function initTiltEffect() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if ('ontouchstart' in window) return;

        const cards = document.querySelectorAll('.hiw-sample-card, .mock-card');

        cards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                const rotateX = (y - centerY) / 20;
                const rotateY = (centerX - x) / 20;

                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });
    }

    // ==========================================
    // COUNTER ANIMATION
    // ==========================================

    function animateCounter(element, target, duration = 2000) {
        const start = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (ease-out-expo)
            const easeOut = 1 - Math.pow(2, -10 * progress);
            const current = Math.floor(start + (target - start) * easeOut);

            // Format the number
            if (target >= 1000000) {
                element.textContent = (current / 1000000).toFixed(1) + 'M+';
            } else if (target >= 1000) {
                element.textContent = Math.floor(current / 1000) + 'K+';
            } else {
                element.textContent = current.toLocaleString();
            }

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    function initCounterAnimation() {
        const counters = document.querySelectorAll('.stat-number[data-count]');
        if (counters.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = parseInt(entry.target.dataset.count, 10);
                    animateCounter(entry.target, target);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(counter => observer.observe(counter));
    }

    // ==========================================
    // CURSOR GLOW EFFECT
    // ==========================================

    function initCursorGlow() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if ('ontouchstart' in window) return;

        const glow = document.createElement('div');
        glow.className = 'cursor-glow';
        glow.style.cssText = `
            position: fixed;
            width: 400px;
            height: 400px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(20, 184, 166, 0.08) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
            transform: translate(-50%, -50%);
            transition: opacity 0.3s ease;
            opacity: 0;
        `;
        document.body.appendChild(glow);

        let mouseX = 0, mouseY = 0;
        let glowX = 0, glowY = 0;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            glow.style.opacity = '1';
        });

        document.addEventListener('mouseleave', () => {
            glow.style.opacity = '0';
        });

        function animateGlow() {
            glowX += (mouseX - glowX) * 0.1;
            glowY += (mouseY - glowY) * 0.1;

            glow.style.left = glowX + 'px';
            glow.style.top = glowY + 'px';

            requestAnimationFrame(animateGlow);
        }

        animateGlow();
    }

    // ==========================================
    // TEXT SCRAMBLE EFFECT
    // ==========================================

    class TextScramble {
        constructor(el) {
            this.el = el;
            this.chars = '!<>-_\\/[]{}—=+*^?#________';
            this.update = this.update.bind(this);
        }

        setText(newText) {
            const oldText = this.el.innerText;
            const length = Math.max(oldText.length, newText.length);
            const promise = new Promise(resolve => this.resolve = resolve);

            this.queue = [];
            for (let i = 0; i < length; i++) {
                const from = oldText[i] || '';
                const to = newText[i] || '';
                const start = Math.floor(Math.random() * 40);
                const end = start + Math.floor(Math.random() * 40);
                this.queue.push({ from, to, start, end });
            }

            cancelAnimationFrame(this.frameRequest);
            this.frame = 0;
            this.update();
            return promise;
        }

        update() {
            let output = '';
            let complete = 0;

            for (let i = 0, n = this.queue.length; i < n; i++) {
                let { from, to, start, end, char } = this.queue[i];

                if (this.frame >= end) {
                    complete++;
                    output += to;
                } else if (this.frame >= start) {
                    if (!char || Math.random() < 0.28) {
                        char = this.chars[Math.floor(Math.random() * this.chars.length)];
                        this.queue[i].char = char;
                    }
                    output += `<span class="scramble-char">${char}</span>`;
                } else {
                    output += from;
                }
            }

            this.el.innerHTML = output;

            if (complete === this.queue.length) {
                this.resolve();
            } else {
                this.frameRequest = requestAnimationFrame(this.update);
                this.frame++;
            }
        }
    }

    // ==========================================
    // TYPING EFFECT
    // ==========================================

    function initTypingEffect() {
        const elements = document.querySelectorAll('[data-typing]');
        if (elements.length === 0) return;

        elements.forEach(el => {
            const text = el.dataset.typing;
            const speed = parseInt(el.dataset.typingSpeed, 10) || 50;
            let i = 0;

            el.textContent = '';
            el.style.visibility = 'visible';

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const type = () => {
                            if (i < text.length) {
                                el.textContent += text.charAt(i);
                                i++;
                                setTimeout(type, speed);
                            }
                        };
                        type();
                        observer.unobserve(el);
                    }
                });
            }, { threshold: 0.5 });

            observer.observe(el);
        });
    }

    // ==========================================
    // AUTO-ADD REVEAL CLASSES
    // ==========================================

    function autoAddRevealClasses() {
        // Add reveal classes to major sections
        const sectionsToReveal = [
            '.testimonial-highlight',
            '.stats-strip',
            '.lead-signals',
            '.proof-section',
            '.how-it-works',
            '.use-cases',
            '.what-you-get',
            '.social-proof',
            '.pricing',
            '.final-cta'
        ];

        sectionsToReveal.forEach(selector => {
            const section = document.querySelector(selector);
            if (section && !section.classList.contains('reveal')) {
                section.classList.add('reveal');
            }
        });

        // Add stagger to grid children
        const gridsToStagger = [
            '.lead-signals-grid',
            '.use-cases-grid',
            '.pricing-grid',
            '.social-proof-container'
        ];

        gridsToStagger.forEach(selector => {
            const grid = document.querySelector(selector);
            if (grid && !grid.classList.contains('stagger-children')) {
                grid.classList.add('stagger-children');
            }
        });

        // Add reveal-left and reveal-right for split sections
        const hiwContent = document.querySelector('.hiw-content');
        const hiwVisual = document.querySelector('.hiw-visual');
        if (hiwContent) hiwContent.classList.add('reveal-left');
        if (hiwVisual) hiwVisual.classList.add('reveal-right');

        const wygContent = document.querySelector('.wyg-content');
        const wygVisual = document.querySelector('.wyg-visual');
        if (wygContent) wygContent.classList.add('reveal-left');
        if (wygVisual) wygVisual.classList.add('reveal-right');
    }

    // ==========================================
    // INITIALIZE EVERYTHING
    // ==========================================

    function init() {
        // Wait for DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // Auto-add reveal classes
        autoAddRevealClasses();

        // Initialize all features
        initScrollReveal();
        initNavScroll();
        initSmoothScroll();
        initMagneticButtons();
        initTiltEffect();
        initCounterAnimation();
        initCursorGlow();
        initTypingEffect();

        // Optional: Parallax (can be heavy on performance)
        // initParallax();

        console.log('BevAlc Animations initialized');
    }

    // Start initialization
    init();

    // Export for external use
    window.BevAlcAnimations = {
        TextScramble,
        animateCounter,
        init
    };

})();
