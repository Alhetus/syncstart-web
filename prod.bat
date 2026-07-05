(
   start "task1" cmd /C "cd frontend & npm run build & npm run preview"
   start "task2" cmd /C "cd backend & npm run start"
) | pause
