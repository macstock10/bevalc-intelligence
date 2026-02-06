/* Hub Pages — category landing page UI handlers */

function showUpgradeModal() {
    document.getElementById('upgrade-modal').classList.add('active');
}

function closeUpgradeModal() {
    document.getElementById('upgrade-modal').classList.remove('active');
}

function handleExportClick() {
    var isPro = document.cookie.includes('bevalc_pro=1');
    if (isPro) {
        var hubPage = document.querySelector('.hub-page');
        var category = hubPage ? hubPage.getAttribute('data-category') : '';
        window.location.href = '/database?category=' + encodeURIComponent(category) + '&export=csv';
    } else {
        showUpgradeModal();
    }
}

// Close modal on overlay click
var upgradeModal = document.getElementById('upgrade-modal');
if (upgradeModal) {
    upgradeModal.addEventListener('click', function(e) {
        if (e.target === this) closeUpgradeModal();
    });
}
