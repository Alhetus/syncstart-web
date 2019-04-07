(
   start "task1" cmd /C "cd frontend & npm run build-and-serve"
   start "task2" cmd /C "cd backend & npm run start"
) | pause
