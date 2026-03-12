#!/bin/bash
# Post-install script for Mwaka POS
# Installs udev rules for thermal printer USB access

set -e

echo "[Mwaka POS] Installing udev rules for thermal printer access..."

# Install udev rules
if [ -f "/opt/handy-pos/99-thermal-printers.rules" ]; then
    sudo cp /opt/handy-pos/99-thermal-printers.rules /etc/udev/rules.d/99-thermal-printers.rules
    echo "[Mwaka POS] ✓ udev rules installed"
    
    # Reload udev rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "[Mwaka POS] ✓ udev rules reloaded"
else
    echo "[Mwaka POS] ⚠ udev rules file not found at /opt/handy-pos/99-thermal-printers.rules"
fi

# Add current user to lp group for printer access
if ! groups "$USER" | grep -q "\blp\b"; then
    echo "[Mwaka POS] Adding user to 'lp' group for printer access..."
    sudo usermod -a -G lp "$USER"
    echo "[Mwaka POS] ✓ User added to 'lp' group"
    echo "[Mwaka POS] ⚠ Please log out and log back in for group changes to take effect"
else
    echo "[Mwaka POS] ✓ User already in 'lp' group"
fi

echo "[Mwaka POS] Installation complete!"
