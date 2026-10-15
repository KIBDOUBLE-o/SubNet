pyinstaller --name SubNetMaster --icon icon.ico --noconfirm master.py
copy "./master.uinterface" "./dist/SubNetMaster/"
copy "./fullscreen.uinterface" "./dist/SubNetMaster/"
pause